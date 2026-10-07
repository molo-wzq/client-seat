import { useEffect, useRef, useState } from "react";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import { cleanReplyText } from "../domain/reply-text";
import type { Conversation, ConversationResult, FeelingStamp, Persona, PlayerObservation } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { BusyHint } from "./BusyHint";
import { UiIcon } from "./UiIcon";
import { playSfx } from "./game-feel";
import { FeelingStampBar } from "./feeling-stamps";

/**
 * 快捷回复(票 31):客户角色的典型信号一键发送。
 * 按对话局势切三组——接通时 / 探询期 / 经理报出产品后,和策略卡的信号语义对齐。
 * 台词跟画像的关系与语气走,不替客户补写资金事实;
 * 画像取不到时(接口桩/未加载完)回落到通用组。
 */
export function quickReplies(conversation: Conversation | null, personas: Persona[] = []): string[] {
  const turns = conversation?.turns ?? [];
  const persona = personas.find((p) => p.id === conversation?.personaId);
  const elderly = persona?.visible.some((line) => /年长|退休|阿姨|大爷/.test(line)) ?? false;
  const acquainted = persona?.visible.some((line) => /已相识|已认识|与经理熟悉/.test(line)) ?? false;
  const lastManager = [...turns].reverse().find((t) => t.speaker === "manager");
  if (!lastManager) {
    return elderly && acquainted ? ["喂,是小王啊", "喂,哪位?", "你们谁啊?"] : ["喂", "喂,你好,哪位?", "你谁啊?"];
  }
  if (/立减金|报名|活动.*(?:参加|领取)|(?:参加|领取).*活动/.test(lastManager.text)) {
    return elderly
      ? ["这个活动咋参加?", "规则你再说说", "那你帮我报上吧", "那我再考虑一下"]
      : ["怎么参加?", "再考虑一下吧", "帮我报上吧", "不用了,谢谢"];
  }
  if (/收益|参考年化|灵活理财|持有期|T\+1|产品/.test(lastManager.text)) {
    return ["这个产品怎么取用?", "收益是保证的吗?", "那我再考虑一下", "暂时不用,谢谢"];
  }
  return elderly
    ? ["你先说说是啥事", "你问的是哪笔钱?", "你少说点,我慢慢听", "暂时不用,谢谢"]
    : ["还行,你说", "你想了解哪方面?", "暂时不用,谢谢", "你先说说来意"];
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
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const draftRef = useRef("");
  const followLatest = useRef(true);
  const [hasUnread, setHasUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState("理财经理正在思考…");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // 流式话术(票 29):话术增量先拼在这里逐字上屏,done 事件落地后被权威会话替换。
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [copiedTurn, setCopiedTurn] = useState<number | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const composingRef = useRef(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef(true);
  const loadedIdRef = useRef<string | null>(null);
  const uncertainRef = useRef<{ text: string; number: number } | null>(null);
  // 体感戳保存中:同一时刻只发一枚,避免两枚乐观更新互相覆盖。
  const [stampingTurn, setStampingTurn] = useState<number | null>(null);
  const observationReady = typeof api.saveObservation === "function";

  function updateDraft(value: string) {
    draftRef.current = value;
    setText(value);
  }

  function recoverUndelivered(customerText: string) {
    if (draftRef.current.trim()) setFailedDraft(customerText);
    else updateDraft(customerText);
  }

  function showLatest() {
    followLatest.current = true;
    setHasUnread(false);
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

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
    if (!activeRef.current) return;
    setConversation(next);
    onConversationChange?.(next);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConversation(null);
    if (loadedIdRef.current !== conversationId) {
      loadedIdRef.current = conversationId;
      updateDraft("");
      setFailedDraft(null);
      uncertainRef.current = null;
    }
    followLatest.current = true;
    setHasUnread(false);
    api
      .getConversation(conversationId)
      .then((c) => {
        if (cancelled) return;
        const uncertain = uncertainRef.current;
        if (uncertain) {
          if (!c.turns.some((t) => t.number === uncertain.number && t.speaker === "customer" && t.text === uncertain.text)) {
            recoverUndelivered(uncertain.text);
          }
          uncertainRef.current = null;
        }
        setConversation(c);
        onConversationChange?.(c);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [api, conversationId, loadAttempt]);

  useEffect(() => {
    if (followLatest.current) showLatest();
    else setHasUnread(true);
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
    updateDraft("");
    setFailedDraft(null);
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
            if (!activeRef.current) return;
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
      if (!activeRef.current) return;
      const stopped = controller.signal.aborted && (e as Error).name === "AbortError";
      // 网络断流与主动停止都可能发生在落库之后,不能把请求失败当作未发送。
      abortRef.current = null;
      setStreamingReply(null);
      setBusyHint("正在同步本轮通话，请稍候…");
      const sentNumber = Math.max(0, ...previous.turns.map((t) => t.number)) + 1;
      try {
        const authoritative = await api.getConversation(conversationId);
        if (!activeRef.current) return;
        applyConversation(authoritative);
        const saved = authoritative.turns.some((t) => t.number === sentNumber && t.speaker === "customer" && t.text === customerText);
        if (!saved) recoverUndelivered(customerText);
        if (!stopped) setError(saved ? `连接中断，本轮已保存并同步：${(e as Error).message}` : (e as Error).message);
      } catch (syncError) {
        if (!activeRef.current) return;
        uncertainRef.current = { text: customerText, number: sentNumber };
        setConversation(null);
        setError(`通话同步失败，请重新加载：${(syncError as Error).message}`);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStreamingReply(null);
      if (activeRef.current) replyRef.current?.focus({ preventScroll: true });
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

  /**
   * 盖/撤一枚体感戳:与该轮已有观察合并后整条保存,
   * 不覆盖判断、依据等已写内容;乐观上屏,失败回滚并提示。
   */
  async function stampFeeling(turnNumber: number, next: FeelingStamp | undefined) {
    if (!conversation || stampingTurn !== null) return;
    const previous = conversation;
    const saved = previous.observations?.find((note) => note.managerTurnNumber === turnNumber);
    if (saved?.feeling === next) return;
    const merged: PlayerObservation = {
      managerTurnNumber: turnNumber,
      evidence: saved?.evidence ?? "",
      nextExperiment: saved?.nextExperiment ?? "",
      ...(saved?.judgement ? { judgement: saved.judgement } : {}),
      revealed: saved?.revealed ?? false,
      marked: saved?.marked ?? false,
      ...(next ? { feeling: next } : {}),
    };
    applyConversation({
      ...previous,
      observations: [...(previous.observations ?? []).filter((note) => note.managerTurnNumber !== turnNumber), merged].sort(
        (a, b) => a.managerTurnNumber - b.managerTurnNumber,
      ),
    });
    setStampingTurn(turnNumber);
    try {
      applyConversation(await api.saveObservation(conversationId, merged));
    } catch (e) {
      if (activeRef.current) {
        applyConversation(previous);
        setError((e as Error).message);
      }
    } finally {
      if (activeRef.current) setStampingTurn(null);
    }
  }

  async function finish() {
    if (!conversation || busy || loading) return;
    playSfx("end");
    setBusy(true);
    setBusyHint("正在生成对练结果…");
    setError(null);
    try {
      if (conversation?.status === "ongoing") {
        applyConversation(await api.finishConversation(conversationId));
      }
      const result = await api.getResult(conversationId);
      if (activeRef.current) onFinished(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="step" aria-labelledby="call-title">
      <div className="call-heading">
        <h2 id="call-title">模拟通话</h2>
        <button type="button" className="ghost call-exit" onClick={finish} disabled={busy || loading || !conversation}>
          结束并查看结果
        </button>
      </div>
      <p className="hint">
        {ended ? "本局已结束。查看复盘，观察经理如何回应你的客户信号。"
          : managerTurnCount === 0 ? "你扮演生客,AI 扮演理财经理。电话已接通,输入你作为客户的第一句话(如「喂」)。"
          : "按画像回应经理，可以追问、犹豫或拒绝。快捷回复只是选择，也可以自己写。听完经理某句话，随手盖一枚体感戳，复盘时会对照他那轮的打法。"}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
          {!conversation && !loading && <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>重新加载通话</button>}
        </p>
      )}
      {ended && (
        <p className="ended-note">通话已结束:{conversation?.endReason}</p>
      )}
      {loading && <BusyHint text="正在加载通话…" />}
      <ol className={`call-log${conversation?.turns.length === 0 && !busy ? " empty" : ""}`} ref={logRef} onScroll={(e) => {
        const log = e.currentTarget;
        followLatest.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
        if (followLatest.current) setHasUnread(false);
      }}>
        {conversation && conversation.turns.length === 0 && !busy && !ended && <li className="empty-call">
          <strong>电话已接通</strong>
          <p>选一句开场，或在下方输入你的客户回应。</p>
        </li>}
        {conversation?.turns.map((turn) => (
          <li key={turn.number} className={`turn turn-${turn.speaker}`}>
            <span className="who">
              {turn.speaker === "customer" ? "你(生客)" : "理财经理(AI)"}
            </span>
            <p>{turn.text}</p>
            {turn.speaker === "manager" && observationReady && (
              <FeelingStampBar
                value={conversation.observations?.find((note) => note.managerTurnNumber === turn.number)?.feeling}
                disabled={stampingTurn !== null}
                onPick={(next) => void stampFeeling(turn.number, next)}
              />
            )}
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
      {hasUnread && <button type="button" className="ghost latest-reply" onClick={showLatest}>查看最新通话</button>}
      {busy && (
        <BusyHint
          text={
            streamingReply !== null
              ? "理财经理正在回复，随后核对本轮用卡与收口信号…"
              : busyHint
          }
        />
      )}
      {!ended && conversation && !loading && (
        <div className="reply-box">
          <div className="quick-chips" role="group" aria-label="快捷回复">
            {quickReplies(conversation, personas).map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => {
                  updateDraft(draftRef.current.trim() ? `${draftRef.current}\n${chip}` : chip);
                  replyRef.current?.focus({ preventScroll: true });
                }}
              >
                {chip}
              </button>
            ))}
          </div>
          <label htmlFor="customer-reply">客户回复</label>
          <textarea
            ref={replyRef}
            id="customer-reply"
            rows={2}
            value={text}
            onChange={(e) => updateDraft(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="作为客户回应……"
            aria-describedby="reply-key-hint"
          />
          <small id="reply-key-hint" className="hint-inline">Enter 发送 · Shift + Enter 换行 · 快捷回复先填入，确认后发送</small>
          {failedDraft && <aside className="failed-draft" aria-label="未发出的回复">
            <p>上一句未发出：{failedDraft}。你正在写的草稿已保留。</p>
            <button type="button" className="ghost" disabled={busy} onClick={() => {
              updateDraft(draftRef.current.trim() ? `${failedDraft}\n${draftRef.current}` : failedDraft);
              setFailedDraft(null);
            }}>把失败发言接到草稿前</button>
            <button type="button" className="ghost" onClick={() => setFailedDraft(null)}>放弃失败发言</button>
          </aside>}
          <div className="actions">
            <span className="turn-count">
              经理第 {managerTurnCount}/{MAX_MANAGER_TURNS} 轮
            </span>
            {canRegenerate && (
              <button type="button" className="ghost" onClick={() => void regenerate()} disabled={busy} title="重新生成本轮，原回复会保存到版本对照">
                <UiIcon name="refresh" />重新生成 · 保留原句
              </button>
            )}
            <button
              onClick={() => (busy ? stop() : void send())}
              disabled={busy ? !abortRef.current : !text.trim()}
              className={busy ? "danger" : undefined}
            >
              {busy ? (
                <>
                  <UiIcon name="stop" />{abortRef.current ? "停止显示" : "处理中"}
                </>
              ) : (
                "发送"
              )}
            </button>
          </div>
        </div>
      )}
      {!ended && <p className="hint">{busy
        ? abortRef.current ? "可先停止显示；同步已保存话术后，再结束并查看结果。" : "本轮处理中；处理完成后可结束并查看结果。"
        : "明确表示要挂断或不再联系会结束通话；犹豫时可以继续了解，也可点击“结束并查看结果”。"}</p>}
    </section>
  );
}
