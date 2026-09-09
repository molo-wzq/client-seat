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
  }, [conversation?.turns.length]);

  const ended = conversation?.status === "ended";
  const managerTurnCount =
    conversation?.turns.filter((t) => t.speaker === "manager").length ?? 0;

  async function send() {
    const customerText = text.trim();
    if (!customerText || !conversation || ended) return;
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
    setError(null);
    try {
      applyConversation(await api.sendCustomerTurn(conversationId, customerText));
    } catch (e) {
      applyConversation(previous);
      setText(customerText);
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
            <span className="turn-count">
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
