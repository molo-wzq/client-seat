import { useEffect, useState } from "react";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import type { Conversation, ConversationResult, FeelingStamp, Persona, StrategyCard } from "../domain/types";
import { FEELING_STAMP_META } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { CallStep } from "./CallStep";
import { UiIcon } from "./UiIcon";
import { PersonaAvatar } from "./PersonaAvatar";
import { StrategyRail } from "./TavernRail";
import { observationFocus } from "./observation-focus";
import { ProductFacts } from "./ProductFacts";
import { SEED_PRODUCT_CARD } from "../domain/seed";
import { ObservationNotebook } from './ObservationNotebook';

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
  const notebookEnabled = typeof api.saveObservation === 'function';
  const explanationRevealed = !notebookEnabled || !lastManager || conversation?.observations?.some((note) => note.managerTurnNumber === lastManager.number && note.revealed);
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
          <h3><UiIcon name="lock" />隐藏牌(扣着)</h3>
          <p className="hint">仅你知情,AI 不可见</p>
          <ul className="info-list hidden-hand">
            {(snapshotPersona?.hidden.length ? snapshotPersona.hidden : ["无"]).map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
          <p className="role-reminder">按画像自然回应；聊到相关话题时，再决定是否透露隐藏信息。</p>
        </details>

        <div className="call-board">
          <aside className="observation-reminder" aria-label="本局观察点">
            <strong>{observationFocus(conversation?.observationFocus).question}</strong>
            <span>按画像自然回应，结束后用原话核对。{conversation?.replayOfId ? " 本局结算可与原局对照。" : ""}</span>
            <details className="call-product-facts">
              <summary>查看参数 · 活动与产品</summary>
              {!conversation?.productFacts && <p className="hint">旧记录未保存当时参数，以下按当前默认参数查看。</p>}
              <ProductFacts product={conversation?.productFacts ?? SEED_PRODUCT_CARD} />
            </details>
            {lastManager?.factCheckNotes?.length ? <details className="live-fact-notes">
              <summary>本轮事实核对 · {lastManager.factCheckNotes.length} 条候选</summary>
              <ul>{lastManager.factCheckNotes.map((note, index) => <li key={index}>{note}</li>)}</ul>
              <span>请对照参数核实；匹配到卡不表示事实正确。</span>
            </details> : null}
          </aside>
          <ol className="call-track" aria-label="通话轨道">
            {Array.from({ length: MAX_MANAGER_TURNS }, (_, i) => {
              const managerTurn = i < managerTurnCount ? managerTurns[i] : undefined;
              const feeling: FeelingStamp | undefined = managerTurn
                ? conversation?.observations?.find((note) => note.managerTurnNumber === managerTurn.number)?.feeling
                : undefined;
              const feelingMeta = feeling ? FEELING_STAMP_META[feeling] : undefined;
              return (
                <li
                  key={i}
                  className={`track-cell${i < managerTurnCount ? " passed" : ""}${feeling ? " has-feeling" : ""}`}
                  aria-current={i === managerTurnCount - 1 ? "step" : undefined}
                  title={feelingMeta ? `你盖的体感戳:${feelingMeta.label}` : undefined}
                >
                  {i + 1}
                  {feelingMeta && <span className="track-feeling" data-feeling={feeling} aria-hidden="true">{feelingMeta.seal}</span>}
                </li>
              );
            })}
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
          {notebookEnabled && conversation && lastManager && <ObservationNotebook api={api} conversation={conversation} turn={lastManager} onSaved={onConversationChange} />}
        </div>
        {explanationRevealed ?
        <StrategyRail
          cards={conversation?.resources?.cards ?? publishedCards}
          activeCardId={activeCardId}
          currentGoal={currentGoal}
          recognizedSignal={lastManager?.recognizedSignal}
          matchBasis={lastManager?.cardMatchBasis}
          hasManagerTurn={Boolean(lastManager)}
          slam={null}
        />
        : <aside className="strategy-board tavern-rail"><h3>本轮解释暂时收起</h3><p>先用原话作一次判断，或选择“先查看解释”。回复客户不需要先填写观察。</p></aside>}
      </div>
    </section>
  );
}
