import { useEffect, useId, useRef, useState } from "react";
import type { ConversationTurn, VirtualProductCard } from "../domain/types";
import { PET_COACH_HISTORY_LIMIT, PET_COACH_QUESTION_LIMIT, type PetCoachExchange } from "../shared/pet-coach-contract";
import type { AgentClient } from "./agent-client";

export type PetCoachRound = Pick<ConversationTurn, "number" | "text">;

const prompts = [
  { label: "解释这句", topic: "explain" },
  { label: "给我一句婉拒", topic: "decline" },
  { label: "核对本局产品卡", topic: "product" },
] as const;

type Topic = (typeof prompts)[number]["topic"];

function observe(text: string) {
  if (/验证码|银行卡号|身份证号|资金密码/.test(text)) {
    return "这句提到了个人资料或验证信息。可以先问用途，暂缓提供。";
  }
  if (/立减金|新资金|活动档位/.test(text)) {
    return "这句提到了活动权益。可以先问清参加条件，再决定是否报名。";
  }
  if (/大概有个多少|大概有多少|资金.{0,8}什么时候到账|钱.{0,8}什么时候到账|平时.{0,8}钱.{0,8}怎么安排/.test(text)) {
    return "经理在问你的资金情况。你可以先问来意，再决定说多少。";
  }
  return null;
}

function answer(topic: Topic | undefined, hint: string | null, facts: VirtualProductCard | undefined) {
  switch (topic) {
    case "explain":
      return hint ?? "这句没有命中演示提示。你可以追问经理这句话想确认什么。";
    case "decline":
      return "我先了解一下条件，今天不提供资金情况，也不报名。您可以把正式说明发给我。";
    case "product": {
      if (!facts) return "这局没有保存产品卡，暂时无法核对。";
      const { activity, flexibleProduct } = facts;
      const tiers = activity.tiers.map(({ amount, reward }) => `${amount}档为${reward}`).join("、");
      return `本局产品卡记载：${flexibleProduct.name}，${flexibleProduct.liquidity}。${flexibleProduct.referenceYield}。${activity.name}，${activity.deadline}。${activity.rule}。${tiers}。`;
    }
    default:
      return "当前是本地演示。你可以问这句是什么意思、怎么婉拒，或核对本局产品卡。";
  }
}

function topicFor(text: string): Topic | undefined {
  if (/产品|收益|利率|利息|立减金|核对/.test(text)) return "product";
  if (/拒绝|婉拒|怎么回|怎么说/.test(text)) return "decline";
  if (/解释|意思|为什么|想干嘛/.test(text)) return "explain";
}

export function PetCoach({ conversationId, revision, round, facts, askModel }: {
  conversationId: string;
  revision?: number;
  round: PetCoachRound;
  facts?: VirtualProductCard;
  askModel?: AgentClient["askPetCoach"];
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<(PetCoachExchange & { mode: "demo" | "model" })[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const hint = observe(round.text);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function ask(question: string, topic: Topic | undefined, clearDraft = false) {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setError("");
    setPending(true);
    try {
      const result = await askModel?.(conversationId, {
        turnNumber: round.number,
        revision,
        question,
        history: messages.slice(-PET_COACH_HISTORY_LIMIT).map(({ question, reply }) => ({ question, reply })),
      }, controller.signal);
      if (controller.signal.aborted) return;
      const exchange = result?.mode === "model"
        ? { question, reply: result.reply, mode: result.mode }
        : { question, reply: answer(topic, hint, facts), mode: "demo" as const };
      setMessages((current) => [...current, exchange]);
      if (clearDraft) setDraft("");
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "桌宠请求失败，请重试。");
      }
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <div className="desk-pet-coach" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="desk-pet-action"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "收起桌宠私聊" : hint ? "桌宠有一条提示" : "桌宠私聊"}
      </button>
      {!open && hint && <p className="desk-pet-coach-hint" role="status">{hint}</p>}
      {open && <section id={panelId} className="desk-pet-coach-panel" aria-label="桌宠私聊">
        <p>第 {round.number} 轮 · 经理原话</p>
        <blockquote>{round.text}</blockquote>
        {hint && <p>{hint}</p>}
        <div className="desk-pet-coach-prompts">
          {prompts.map(({ label, topic }) => (
            <button type="button" className="desk-pet-action" key={topic} disabled={pending} onClick={() => void ask(label, topic)}>
              {label}
            </button>
          ))}
        </div>
        <div role="log" aria-label="私聊消息">
          {messages.map(({ question, reply, mode }, index) => (
            <div className="desk-pet-coach-message" key={index}>
              <p><strong>你</strong> {question}</p>
              <p><strong>{mode === "demo" ? "桌宠 · 演示" : "桌宠"}</strong> {reply}</p>
            </div>
          ))}
        </div>
        <form onSubmit={(event) => {
          event.preventDefault();
          const question = draft.trim();
          if (!question) return;
          void ask(question, topicFor(question), true);
        }}>
          <input
            aria-label="问桌宠"
            placeholder="问问经理刚才这句话"
            value={draft}
            maxLength={PET_COACH_QUESTION_LIMIT}
            readOnly={pending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="desk-pet-action" disabled={pending || !draft.trim()}>私聊发送</button>
        </form>
        {pending && <p role="status">桌宠正在回答…</p>}
        {error && <p role="alert">{error}</p>}
      </section>}
    </div>
  );
}
