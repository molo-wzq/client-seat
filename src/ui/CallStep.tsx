import { useEffect, useRef, useState } from "react";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import { cleanReplyText } from "../domain/reply-text";
import type { Conversation, ConversationResult, Persona } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { BusyHint } from "./BusyHint";
import { UiIcon } from "./UiIcon";
import { playSfx } from "./game-feel";

/**
 * 快捷回复(票 31):客户角色的典型信号一键发送。
 * 按对话局势切三组——接通时 / 探询期 / 经理报出产品后,和策略卡的信号语义对齐。
 * 台词跟画像走(p3 用词规则):年长客户说的是定期到期和养老金,不是股市;
 * 画像取不到时(接口桩/未加载完)回落到通用组。
 */
export function quickReplies(conversation: Conversation | null, personas: Persona[] = []): string[] {
  const turns = conversation?.turns ?? [];
  const persona = personas.find((p) => p.id === conversation?.personaId);
  const elderly = persona?.visible.some((line) => /年长|退休|阿姨|大爷/.test(line)) ?? false;
  const lastManager = [...turns].reverse().find((t) => t.speaker === "manager");
  if (!lastManager) {
    return elderly ? ["喂,是小李啊", "喂,哪位?", "你们谁啊?"] : ["喂", "喂,你好,哪位?", "你谁啊?"];
  }
  if (/立减金|收益|报名|活动|万/.test(lastManager.text)) {
    return elderly
      ? ["那个立减金咋领?", "能领多少啊?", "那你帮我报上吧", "那我再考虑一下"]
      : ["怎么参加?", "再考虑一下吧", "帮我报上吧", "不用了,谢谢"];
  }
  return elderly
    ? ["钱都存着定期呢", "有笔存款到期了还没动", "我不懂这些,你少说点", "暂时不用,谢谢"]
    : ["还行,你说", "我平时闲钱都在股市", "暂时不用,谢谢", "你们这个安全吗?"];
}

export function CallStep({
  api,
  conversationId,
  onFinished,
  onConversationChange,
}: {
  api: ProductCore;
  conversationId: string;
  onFinished: (result: ConversationResult) => void;
  onConversationChange?: (conversation: Conversation) => void;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  // 画像用于快捷回复的台词分流;接口桩可能没有该方法,取不到就回落通用组。
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState("理财经理正在思考…");
  const [error, setError] = useState<string | null>(null);
  // 流式话术(票 29):话术增量先拼在这里逐字上屏,done 事件落地后被权威会话替换。
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [copiedTurn, setCopiedTurn] = useState<number | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  useEffect(() => {
    let alive = true;
    if (typeof api.listPersonas !== "function") return;
    api
      .listPersonas()
      .then((all) => {
        if (alive) setPersonas(all);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  function applyConversation(next: Conversation) {
    setConversation(next);
    onConversationChange?.(next);
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getConversation(conversationId)
      .then((c) => {
        if (cancelled) return;
        setConversation(c);
        onConversationChange?.(c);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [api, conversationId]);

  useEffect(() => {
    // jsdom 未实现 Element.scrollTo,用可选调用兜底。
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [conversation?.turns.length, streamingReply]);

  const ended = conversation?.status === "ended";
  const managerTurnCount =
    conversation?.turns.filter((t) => t.speaker === "manager").length ?? 0;
  // 重新生成只在"最后一轮是经理话术且通话进行中"可用。
  const canRegenerate =
    !ended && conversation?.turns.at(-1)?.speaker === "manager";

  async function send(override?: string) {
    const customerText = (override ?? text).trim();
    // busy 守卫对 Enter 快捷键同样生效:发送按钮会 disable,但键盘路径必须显式拦,
    // 否则模型响应等待期内可并发触发 sendCustomerTurn,乐观更新互相覆盖。
    if (!customerText || !conversation || ended || busy) return;
    // 出手音效:客户话术离手的瞬间给一记 pop,Enter 键路径没有按压声,在这里补齐。
    playSfx("send");
    // 乐观更新:客户话立即上屏,模型 5–15 秒的等待不显得卡死;失败回滚。
    const previous = conversation;
    applyConversation({
      ...conversation,
      turns: [
        ...conversation.turns,
        {
          number: Math.max(0, ...conversation.turns.map((t) => t.number)) + 1,
          speaker: "customer" as const,
          text: customerText,
        },
      ],
    });
    setText("");
    setBusy(true);
    setBusyHint("理财经理正在思考…");
    setStreamingReply(null);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    // 试跑计时(spec C 验收):首字时间与可再次输入时间(含元数据等待),
    // 仅开发环境(非测试)输出到控制台,作为本地诊断,不进对话记录。
    const timingOn =
      import.meta.env.DEV && import.meta.env.MODE !== "test" && typeof performance !== "undefined";
    const startedAt = timingOn ? performance.now() : 0;
    let firstDeltaAt: number | null = null;
    try {
      // 优先走流式接口:话术逐字上屏(票 29);旧桩 API 没有该方法时回退整体返回。
      if (typeof api.sendCustomerTurnStream === "function") {
        const next = await api.sendCustomerTurnStream(
          conversationId,
          customerText,
          (delta) => {
            if (firstDeltaAt === null) firstDeltaAt = performance.now();
            setStreamingReply((current) => (current ?? "") + delta);
          },
          controller.signal,
        );
        applyConversation(next);
      } else {
        applyConversation(await api.sendCustomerTurn(conversationId, customerText));
      }
      if (timingOn) {
        const inputReadyAt = performance.now();
        console.info(
          `[turn-timing] 首字 ${firstDeltaAt !== null ? Math.round(firstDeltaAt - startedAt) : "未收到增量"}ms;` +
            `可再次输入 ${Math.round(inputReadyAt - startedAt)}ms(含元数据等待)`,
        );
      }
    } catch (e) {
      applyConversation(previous);
      setText(customerText);
      // 用户主动停止不算错误:不打扰,不提示。
      if (!(controller.signal.aborted && (e as Error).name === "AbortError")) {
        setError((e as Error).message);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStreamingReply(null);
    }
  }

  /** 停止生成:断开流;服务端可能仍落库该轮,以下次刷新为准。 */
  function stop() {
    abortRef.current?.abort();
  }

  /** 重新生成经理回复(票 31):换掉最后一轮经理话术,不重复客户轮。 */
  async function regenerate() {
    if (!conversation || ended || busy) return;
    const last = conversation.turns.at(-1);
    if (!last || last.speaker !== "manager") return;
    setBusy(true);
    setBusyHint("正在重新生成经理回复…");
    setError(null);
    try {
      applyConversation(await api.regenerateManagerTurn(conversationId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyTurn(turnNumber: number, turnText: string) {
    try {
      await navigator.clipboard.writeText(turnText);
    } catch {
      return; // 剪贴板被浏览器策略拦截时静默放弃,复制不是关键路径
    }
    setCopiedTurn(turnNumber);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedTurn(null), 1600);
  }

  async function finish() {
    playSfx("end");
    setBusy(true);
    setBusyHint("正在生成对练结果…");
    setError(null);
    try {
      if (conversation?.status === "ongoing") {
        await api.finishConversation(conversationId);
      }
      onFinished(await api.getResult(conversationId));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="step" aria-labelledby="call-title">
      <h2 id="call-title">模拟通话</h2>
      <p className="hint">
        你扮演生客,AI 扮演理财经理。电话已接通,输入你作为客户的第一句话(如「喂」)。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {ended && (
        <p className="ended-note">通话已结束:{conversation?.endReason}</p>
      )}
      <ol className="call-log" ref={logRef}>
        {conversation?.turns.map((turn) => (
          <li key={turn.number} className={`turn turn-${turn.speaker}`}>
            <span className="who">
              {turn.speaker === "customer" ? "你(生客)" : "理财经理(AI)"}
            </span>
            <p>{turn.text}</p>
            {turn.speaker === "manager" && (
              <button
                type="button"
                className="turn-copy"
                onClick={() => void copyTurn(turn.number, turn.text)}
                aria-label={`复制第${turn.number}轮经理话术`}
                title="复制话术"
              >
                <UiIcon name="copy" />
                {copiedTurn === turn.number ? "已复制" : ""}
              </button>
            )}
          </li>
        ))}
        {streamingReply !== null ? (
          // 流式话术气泡:首字到达即替换思考气泡,done 后由权威轮次接管。
          // 显示文本与落库共用同一清理:流式中途出现的前缀/引号即时剥掉,
          // 不会先播原文、落库再变样。
          <li className="turn turn-manager typing" aria-hidden="true">
            <span className="who">理财经理(AI)</span>
            <p>
              {cleanReplyText(streamingReply)}
              <span className="stream-caret" aria-hidden="true" />
            </p>
          </li>
        ) : busy && !ended ? (
          // 思考中的占位气泡:纯视觉反馈,语义由下方 BusyHint(role=status)承担。
          <li className="turn turn-manager typing" aria-hidden="true">
            <span className="who">理财经理(AI)</span>
            <p className="typing-dots"><span /><span /><span /></p>
          </li>
        ) : null}
      </ol>
      {busy && (
        <BusyHint
          text={
            streamingReply !== null
              ? "话术已生成,正在核对本轮用卡与收口信号…"
              : busyHint
          }
        />
      )}
      {!ended && (
        <div className="reply-box">
          <div className="quick-chips" role="group" aria-label="快捷回复">
            {quickReplies(conversation, personas).map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => void send(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
          <label htmlFor="customer-reply">客户回复</label>
          <textarea
            id="customer-reply"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="作为客户回应……"
          />
          <div className="actions">
            <span className="turn-count">
              经理第 {managerTurnCount}/{MAX_MANAGER_TURNS} 轮
            </span>
            {canRegenerate && (
              <button type="button" className="ghost" onClick={() => void regenerate()} disabled={busy}>
                <UiIcon name="refresh" />重新生成
              </button>
            )}
            <button
              onClick={() => (busy ? stop() : void send())}
              disabled={!busy && !text.trim()}
              className={busy ? "danger" : undefined}
            >
              {busy ? (
                <>
                  <UiIcon name="stop" />停止
                </>
              ) : (
                "发送"
              )}
            </button>
          </div>
        </div>
      )}
      <div className="actions">
        <button onClick={finish} disabled={busy || managerTurnCount === 0}>
          结束并查看结果
        </button>
      </div>
    </section>
  );
}
