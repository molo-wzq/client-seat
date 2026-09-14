import { useEffect, useRef, useState } from "react";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import type { Conversation, ConversationResult } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { BusyHint } from "./BusyHint";

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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState("理财经理正在思考…");
  const [error, setError] = useState<string | null>(null);
  // 流式话术(票 29):话术增量先拼在这里逐字上屏,done 事件落地后被权威会话替换。
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

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

  async function send() {
    const customerText = text.trim();
    // busy 守卫对 Enter 快捷键同样生效:发送按钮会 disable,但键盘路径必须显式拦,
    // 否则模型响应等待期内可并发触发 sendCustomerTurn,乐观更新互相覆盖。
    if (!customerText || !conversation || ended || busy) return;
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
    try {
      // 优先走流式接口:话术逐字上屏(票 29);旧桩 API 没有该方法时回退整体返回。
      if (typeof api.sendCustomerTurnStream === "function") {
        const next = await api.sendCustomerTurnStream(conversationId, customerText, (delta) => {
          setStreamingReply((current) => (current ?? "") + delta);
        });
        applyConversation(next);
      } else {
        applyConversation(await api.sendCustomerTurn(conversationId, customerText));
      }
    } catch (e) {
      applyConversation(previous);
      setText(customerText);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStreamingReply(null);
    }
  }

  async function finish() {
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
          </li>
        ))}
        {streamingReply !== null ? (
          // 流式话术气泡:首字到达即替换思考气泡,done 后由权威轮次接管。
          <li className="turn turn-manager typing" aria-hidden="true">
            <span className="who">理财经理(AI)</span>
            <p>
              {streamingReply}
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
      {busy && <BusyHint text={busyHint} />}
      {!ended && (
        <div className="reply-box">
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
            <span className="turn-count" key={managerTurnCount}>
              经理第 {managerTurnCount}/{MAX_MANAGER_TURNS} 轮
            </span>
            <button onClick={send} disabled={busy || !text.trim()}>
              发送
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
