import { useEffect, useState } from "react";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import type { Conversation, ConversationResult, Persona, StrategyCard } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { CallStep } from "./CallStep";
import { UiIcon } from "./UiIcon";
import { PersonaAvatar } from "./PersonaAvatar";
import { StrategyRail } from "./TavernRail";
import { ProductFacts } from "./ProductFacts";
import { SEED_PRODUCT_CARD } from "../domain/seed";

export function TableAct({
  api,
  conversationId,
  conversation,
  persona,
  publishedCards,
  onFinished,
  onConversationChange,
}: {
  api: ProductCore;
  conversationId: string;
  conversation: Conversation | null;
  persona: Persona | null;
  publishedCards: StrategyCard[];
  onFinished: (result: ConversationResult) => void;
  onConversationChange: (conversation: Conversation) => void;
}) {
  const managerTurns = conversation?.turns.filter((t) => t.speaker === "manager") ?? [];
  const managerTurnCount = managerTurns.length;
  const lastManager = managerTurns.at(-1);
  const activeCardId = lastManager?.usedCardId;
  const currentGoal = lastManager?.currentGoal;
  const snapshotPersona = conversation?.resources?.persona ?? persona;
  const remaining = Math.max(0, MAX_MANAGER_TURNS - managerTurnCount);
  const [profileOpen, setProfileOpen] = useState(() => !window.matchMedia?.("(max-width: 820px)").matches);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 820px)");
    if (!media) return;
    const update = () => setProfileOpen(!media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);


  return (
    <section className="act" aria-labelledby="table-title">
      <span className="act-kicker">第二幕 / 通话进行中</span>
      <h2 id="table-title">第2幕 · 对局</h2>
      <div className="table-board">
        <details className="player-board" open={profileOpen} onToggle={(e) => setProfileOpen(e.currentTarget.open)}>
          <summary>你的客户画像 · {snapshotPersona?.name ?? "生客"}</summary>
          <span className="identity-badge customer-badge">● 客户</span>
          <div className="player-profile">
            <PersonaAvatar personaId={snapshotPersona?.id} name={snapshotPersona?.name ?? "生客"} />
            <div>
              <h3>{snapshotPersona?.name ?? "生客"}</h3>
              <p>你扮演 · 可见信息朝上</p>
            </div>
          </div>
          <ul className="info-list">
            {(snapshotPersona?.visible.length ? snapshotPersona.visible : ["未知(经理将在对话中发现)"]).map((line, i) => (
              // 自定义画像允许重复属性行:内容不唯一,key 以位置区分。
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
          <h3><UiIcon name="lock" />你的底细 · 经理看不到</h3>
          <p className="hint">这是你扮演的客户心里有数的事；经理问到了，可以按画像自然透露，也可以不说。</p>
          <ul className="info-list hidden-brief" aria-label="你的底细">
            {(snapshotPersona?.hidden.length ? snapshotPersona.hidden : ["本画像没有隐藏信息"]).map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
          <p className="role-reminder">按画像自然回应；结束后复盘会对照经理问出了哪几条。</p>
        </details>

        <div className="call-board">
          <aside className="observation-reminder" aria-label="本局提示">
            <span>按画像自然回应，结束后用原话核对。{conversation?.replayOfId ? " 本局结算可与原局对照。" : ""}</span>
            <details className="call-product-facts">
              <summary>查看参数 · 活动与产品</summary>
              {!conversation?.productFacts && <p className="hint">旧记录未保存当时参数，以下按当前默认参数查看。</p>}
              <ProductFacts product={conversation?.productFacts ?? SEED_PRODUCT_CARD} />
            </details>
          </aside>
          <ol className="call-track" aria-label="通话轨道">
            {Array.from({ length: MAX_MANAGER_TURNS }, (_, i) => (
              <li
                key={i}
                className={`track-cell${i < managerTurnCount ? " passed" : ""}`}
                aria-current={i === managerTurnCount - 1 ? "step" : undefined}
              >
                {i + 1}
              </li>
            ))}
          </ol>
          <p className={`track-guidance${remaining <= 3 ? " near-end" : ""}`} aria-live="polite">
            {conversation?.status === "ended"
              ? "通话已结束，可以查看复盘。"
              : `还可回应 ${remaining} 次 · ${remaining <= 3 ? "临近轮次上限，可以把最后的顾虑说清。" : "不必打满，随时可以结束并复盘。"}`}
          </p>
          <CallStep
            api={api}
            conversationId={conversationId}
            onFinished={onFinished}
            onConversationChange={onConversationChange}
          />
        </div>
        <StrategyRail
          cards={conversation?.resources?.cards ?? publishedCards}
          activeCardId={activeCardId}
          currentGoal={currentGoal}
          recognizedSignal={lastManager?.recognizedSignal}
          matchBasis={lastManager?.cardMatchBasis}
          hasManagerTurn={Boolean(lastManager)}
          slam={null}
        />
      </div>
    </section>
  );
}
