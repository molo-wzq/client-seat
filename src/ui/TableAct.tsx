import { MAX_MANAGER_TURNS } from "../domain/product-core";
import type { Conversation, ConversationResult, Persona, StrategyCard } from "../domain/types";
import type { ProductApi } from "../product/product-api";
import { CallStep } from "./CallStep";

export function TableAct({
  api,
  conversationId,
  conversation,
  persona,
  publishedCards,
  onFinished,
  onConversationChange,
}: {
  api: ProductApi;
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

  return (
    <section className="act" aria-labelledby="table-title">
      <h2 id="table-title">第 2 幕 · 对局</h2>
      <div className="table-board">
        <div>
          <h3>{persona?.name ?? "生客"}(你扮演)</h3>
          <p className="hint">可见信息朝上</p>
          <ul className="info-list">
            {(persona?.visible.length ? persona.visible : ["未知(经理将在对话中发现)"]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3>隐藏牌(扣着)</h3>
          <p className="hint">仅你知情,AI 不可见</p>
          <ul className="info-list hidden-hand">
            {(persona?.hidden.length ? persona.hidden : ["无"]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div>
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
          <p className="hint">通话轨道:经理每推进一轮走一格;{MAX_MANAGER_TURNS} 格到底强制收口</p>
          <CallStep
            api={api}
            conversationId={conversationId}
            onFinished={onFinished}
            onConversationChange={onConversationChange}
          />
        </div>

        <div>
          <h3>桌面明牌</h3>
          <p className="hint">经理本轮亮出的策略卡(高亮 = 正在用)</p>
          <ul className="card-tiles">
            {publishedCards.map((card) => (
              <li key={card.id} className={`card-tile${card.id === activeCardId ? " active" : ""}`}>
                {card.name}
                {card.id === activeCardId && <span className="badge badge-published">本轮在用</span>}
              </li>
            ))}
          </ul>
          {currentGoal && <p className="hint">当前目的:{currentGoal}</p>}
        </div>
      </div>
    </section>
  );
}
