import { useEffect, useRef, useState } from "react";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import type { Conversation, ConversationResult, Persona, StrategyCard } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { CallStep } from "./CallStep";
import { UiIcon } from "./UiIcon";
import { PersonaAvatar } from "./PersonaAvatar";
import { playSfx, thump } from "./game-feel";

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

  // 出牌演出(打击感核心):经理新亮出一张策略卡时,卡砖从空中砸落 +
  // 桌面震颤 + 拍桌音效。挂载时的初始亮牌(找回进行中对局)不算"出牌",不触发。
  const boardRef = useRef<HTMLDivElement>(null);
  const prevCardRef = useRef<string | null>(activeCardId ?? null);
  const [slam, setSlam] = useState<{ id: string; seq: number } | null>(null);

  useEffect(() => {
    if (activeCardId && activeCardId !== prevCardRef.current) {
      setSlam((current) => ({ id: activeCardId, seq: (current?.seq ?? 0) + 1 }));
      playSfx("card");
      thump(boardRef.current);
    }
    prevCardRef.current = activeCardId ?? null;
  }, [activeCardId]);

  return (
    <section className="act" aria-labelledby="table-title">
      <span className="act-kicker">第二幕 / 通话进行中</span>
      <h2 id="table-title">第2幕 · 对局</h2>
      <div className="table-board" ref={boardRef}>
        <div className="player-board">
          <span className="identity-badge customer-badge">● 客户</span>
          <div className="player-profile">
            <PersonaAvatar personaId={persona?.id} name={persona?.name ?? "生客"} />
            <div>
              <h3>{persona?.name ?? "生客"}</h3>
              <p>你扮演 · 可见信息朝上</p>
            </div>
          </div>
          <ul className="info-list">
            {(persona?.visible.length ? persona.visible : ["未知(经理将在对话中发现)"]).map((line, i) => (
              // 自定义画像允许重复属性行:内容不唯一,key 以位置区分。
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
          <h3><UiIcon name="lock" />隐藏牌(扣着)</h3>
          <p className="hint">仅你知情,AI 不可见</p>
          <ul className="info-list hidden-hand">
            {(persona?.hidden.length ? persona.hidden : ["无"]).map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="call-board">
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

        <div className="strategy-board">
          <span className="identity-badge manager-badge">◆ AI 理财经理</span>
          <h3>桌面明牌</h3>
          <p className="hint">经理本轮亮出的策略卡(高亮 = 正在用)</p>
          <ul className="card-tiles">
            {publishedCards.map((card) => {
              const isActive = card.id === activeCardId;
              // 出牌瞬间 remount 该卡砖,保证 slam 动画在"同一张卡连出两轮"时也能重放。
              const isSlamming = isActive && slam?.id === card.id;
              return (
                <li
                  key={isSlamming ? `${card.id}-slam-${slam?.seq}` : card.id}
                  className={`card-tile${isActive ? " active" : ""}${isSlamming ? " slam" : ""}`}
                >
                  {card.name}
                  {isActive && <span className="badge badge-published">本轮在用</span>}
                </li>
              );
            })}
          </ul>
          {/* key 绑定目的文本:经理更换目的时 remount,重播 goal-in 滑入动画。 */}
          {currentGoal && <p className="current-goal" key={currentGoal}><span>当前目的</span>{currentGoal}</p>}
        </div>
      </div>
    </section>
  );
}
