import type { ReactNode } from "react";
import { CALL_LOGIC_LAWS } from "../domain/call-logic";
import { SEED_PRODUCT_CARD } from "../domain/seed";
import type { StrategyCard } from "../domain/types";
import { UiIcon } from "./UiIcon";

const lawArt: Record<string, { cue: string; path: ReactNode }> = {
  map: {
    cue: "先找到钱的去向",
    path: <><path d="m8 15 15-6 18 6 15-6v39l-15 6-18-6-15 6Z" /><path d="M23 9v39m18-33v39M14 35l6-8 12 7 12-12 7 4" /><circle cx="44" cy="22" r="3" /></>,
  },
  window: {
    cue: "等一个恰好的时机",
    path: <><path d="M17 9h30M17 55h30M21 9v8c0 8 6 10 11 15-5 5-11 7-11 15v8m22-46v8c0 8-6 10-11 15 5 5 11 7 11 15v8" /><path d="m25 20 7 7 7-7M25 48l7-9 7 9Z" /><path d="M12 29H7m50 0h-5" /></>,
  },
  inertia: {
    cue: "给理由，也降摩擦",
    path: <><circle cx="29" cy="27" r="17" /><circle cx="29" cy="27" r="12" /><path d="M32 18h-6v8h6v9h-6m3-20v24M42 27a17 17 0 0 1 0 30H23m-1-9h23m-2-5 6 5-6 5" /></>,
  },
  steps: {
    cue: "从小一步开始",
    path: <><path d="M9 54V42h14V30h14V18h14V8M9 54h46" /><path d="m10 31 34-23m-9 0h9v9M23 42h5m9-12h5" /></>,
  },
};

function LawEmblem({ lawKey }: { lawKey: string }) {
  return (
    <svg className="law-emblem" viewBox="0 0 64 64" aria-hidden="true">
      {lawArt[lawKey]?.path}
    </svg>
  );
}

export function LogicRail() {
  const { activity, flexibleProduct } = SEED_PRODUCT_CARD;
  return (
    <div className="tavern-rail logic-rail" aria-labelledby="logic-rail-title">
      <header className="tavern-rail-heading">
        <span className="rail-crest" aria-hidden="true"><UiIcon name="cards" /></span>
        <div>
          <span className="tavern-eyebrow">牌桌上的四条规律</span>
          <h3 id="logic-rail-title">通话逻辑</h3>
        </div>
        <span className="rail-brass-count" aria-label="四张固定逻辑卡">04</span>
      </header>
      <p className="tavern-rail-caption">每一局都在，决定这通电话怎么走。</p>
      <div className="law-card-rack">
        {CALL_LOGIC_LAWS.map((law, index) => (
          <details className={`law-card law-card-${law.key}`} key={law.key}>
            <summary>
              <span className="law-card-number">{String(index + 1).padStart(2, "0")}</span>
              <LawEmblem lawKey={law.key} />
              <strong>{law.name}</strong>
              <span className="law-card-cue">{lawArt[law.key]?.cue}</span>
              <span className="law-card-open">读牌 <span aria-hidden="true">＋</span></span>
            </summary>
            <div className="law-card-detail">
              <p>{law.law}</p>
              <span>电话里怎么用</span>
              <p>{law.usage}</p>
            </div>
          </details>
        ))}
      </div>
      <details className="table-note">
        <summary>
          <span className="table-note-label">本局参数</span>
          <strong>{activity.name}</strong>
          <span className="table-note-open">查看活动与产品 <span aria-hidden="true">＋</span></span>
        </summary>
        <div className="table-note-body">
          <p>{activity.rule}</p>
          <ul aria-label="分档权益">
            {activity.tiers.map((tier) => (
              <li key={tier.amount}><strong>{tier.amount}</strong><span>{tier.reward}</span></li>
            ))}
          </ul>
          <p className="table-note-deadline">{activity.deadline}</p>
          <strong>{flexibleProduct.name}</strong>
          <p>{flexibleProduct.type} · {flexibleProduct.liquidity}</p>
          <p>{flexibleProduct.referenceYield}</p>
          <p>适用客户：{flexibleProduct.audience}</p>
          <p className="table-note-boundary">本局事实边界，以这些参数为准。</p>
        </div>
      </details>
      <p className="tavern-rail-foot"><span aria-hidden="true">✦</span> 规律定方向 · 参数定边界</p>
    </div>
  );
}

export function StrategyRail({
  cards,
  activeCardId,
  currentGoal,
  recognizedSignal,
  matchBasis,
  hasManagerTurn = false,
  slam,
}: {
  cards: StrategyCard[];
  activeCardId?: string;
  currentGoal?: string;
  recognizedSignal?: string;
  matchBasis?: string;
  hasManagerTurn?: boolean;
  slam: { id: string; seq: number } | null;
}) {
  const hasActiveCard = cards.some((card) => card.id === activeCardId);
  // 当前明牌放在牌架最上方，编号仍沿用原始顺序。
  const displayedCards = cards
    .map((card, index) => ({ card, number: index + 1 }))
    .sort((a, b) => Number(b.card.id === activeCardId) - Number(a.card.id === activeCardId));
  return (
    <div className="strategy-board tavern-rail" aria-labelledby="strategy-rail-title">
      <span className="tavern-eyebrow">AI 理财经理 · 策略卡</span>
      <header className="tavern-rail-heading">
        <span className="rail-crest" aria-hidden="true"><UiIcon name="cards" /></span>
        <h3 id="strategy-rail-title">桌面明牌</h3>
        <span className="rail-brass-count" aria-label={`${cards.length} 张已发布策略卡`}>
          {String(cards.length).padStart(2, "0")}
        </span>
      </header>
      <p className="tavern-rail-caption">亮起的是话术生成后的匹配候选，请对照原话与适用条件。</p>
      {currentGoal && <p className="current-goal" key={currentGoal}><span>当前目的 · 解释候选</span>{currentGoal}</p>}
      {!hasActiveCard && cards.length > 0 && (
        <p className="tavern-waiting">{activeCardId ? "本轮明牌未在当前牌架中" : hasManagerTurn ? "本轮用卡未确认，以经理实际回应为准。" : "等待经理亮牌"}</p>
      )}
      <ul className="card-tiles tavern-strategies" aria-label="已发布策略明牌">
        {displayedCards.map(({ card, number }) => {
          const isActive = card.id === activeCardId;
          const isSlamming = isActive && slam?.id === card.id;
          return (
            <li
              key={isSlamming ? `${card.id}-slam-${slam.seq}` : card.id}
              className={`card-tile${isActive ? " active" : ""}${isSlamming ? " slam" : ""}`}
            >
              <div className="strategy-card-top">
                <span>策略 · {String(number).padStart(2, "0")}</span>
                {isActive && <span className="strategy-lit">匹配候选</span>}
              </div>
              <h4>{card.name}</h4>
              {isActive ? (
                <div className="strategy-card-effect">
                  <span>客户信号 · 解释候选</span>
                  <p>{recognizedSignal || "未确认"}</p>
                  <span>本轮匹配依据 · 候选</span>
                  <p>{matchBasis || "未记录，不能确认执行了哪个动作"}</p>
                  <span>卡内动作参考</span>
                  <p>{card.actionChain[0] || "未知"}</p>
                </div>
              ) : (
                <p className="strategy-card-purpose">{card.currentPurpose || "沟通目的未知"}</p>
              )}
              <details className="strategy-card-details">
                <summary>读牌 <span aria-hidden="true">＋</span></summary>
                <div>
                  <span>客户信号</span>
                  <ul>
                    {(card.triggerSignals.length ? card.triggerSignals : ["未知"]).map((signal, i) => (
                      <li key={i}>{signal}</li>
                    ))}
                  </ul>
                  <span>关键动作</span>
                  <ol>
                    {(card.actionChain.length ? card.actionChain : ["未知"]).map((action, i) => (
                      <li key={i}>{action}</li>
                    ))}
                  </ol>
                  <span>适用场景</span>
                  <p>{card.applicableScenario || '未注明，不能默认适用于所有客户'}</p>
                  <span>适用条件</span>
                  <ul>{(card.applicableConditions.length ? card.applicableConditions : ['未注明，需要结合客户原话核对']).map((condition, i) => <li key={i}>{condition}</li>)}</ul>
                  <span>停止条件</span>
                  <ul>
                    {(card.stopConditions.length ? card.stopConditions : ["未知"]).map((condition, i) => (
                      <li key={i}>{condition}</li>
                    ))}
                  </ul>
                  <p className="strategy-card-source">
                    {card.sourceExcerpt.materialTitle} · {card.sourceExcerpt.turnRange}
                  </p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {cards.length === 0 && <p className="tavern-waiting">牌架暂空。发布策略卡后，明牌会出现在这里。</p>}
      <p className="tavern-rail-foot"><span aria-hidden="true">✦</span> 已发布策略卡 · 全部上桌</p>
    </div>
  );
}
