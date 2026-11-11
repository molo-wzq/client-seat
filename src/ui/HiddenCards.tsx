import { useEffect, useMemo } from "react";
import { judgeReveal } from "../domain/hidden-reveal";
import type { ConversationTurn, StrategyCard } from "../domain/types";
import { reducedMotion } from "./game-feel";

/** 玩家对举牌的二选一:翻开 / 先藏着(按隐藏条目原文记录,只存客户侧)。 */
export type HiddenCardChoice = "flip" | "hold";

/** 牌面状态:扣着 / 举牌待玩家决定 / 已翻开。 */
export type HiddenCardState = "down" | "raised" | "revealed";

/** 牌桌上一张隐藏牌的视图;翻开或举牌时带归因(轮次、策略卡)。 */
export interface HiddenCardView {
  item: string;
  state: HiddenCardState;
  turnNumber?: number;
  cardName?: string;
  /** 曾被经理问到边上(举过牌);「先藏着」后扣着但仍有此标记,结算据此说明漏掉的信号。 */
  everRaised?: boolean;
}

/**
 * 从整局轮次派生隐藏牌桌面(demo 判定,工单 04):
 * 客户说出 → 自动翻开(取首个 reveal 轮的归因);经理问到边上 → 举牌,
 * 玩家点「翻」记 flip(按举牌轮归因)、「先藏着」记 hold(扣到底)。
 * 判定与选择都只存在客户侧,不进经理会话。
 */
export function deriveHiddenBoard(
  items: readonly string[],
  turns: readonly ConversationTurn[],
  cards: readonly StrategyCard[],
  choices: Readonly<Record<string, HiddenCardChoice>> = {},
): HiddenCardView[] {
  const cardNames = new Map(cards.map((card) => [card.id, card.name]));
  // 每个经理轮配对它回应的客户发言;轮次按经理轮序计(牌面标注「第 N 轮」)。
  const rounds: Array<{ managerText: string; customerText: string; turnNumber: number; cardId?: string; cardName?: string }> = [];
  let managerIndex = 0;
  turns.forEach((turn, index) => {
    if (turn.speaker !== "manager") return;
    managerIndex += 1;
    const previous = turns[index - 1];
    rounds.push({
      managerText: turn.text,
      customerText: previous?.speaker === "customer" ? previous.text : "",
      turnNumber: managerIndex,
      ...(turn.usedCardId ? { cardId: turn.usedCardId, cardName: cardNames.get(turn.usedCardId) } : {}),
    });
  });

  return items.map((item) => {
    let raised: HiddenCardView | null = null;
    for (const round of rounds) {
      const [judgment] = judgeReveal([item], round);
      // 客户先说出口就自动翻牌,归因定格在这一轮;之后的 raise 不再覆盖。
      if (judgment.verdict === "reveal") {
        return { item, state: "revealed", turnNumber: judgment.turnNumber, cardName: judgment.cardName };
      }
      if (judgment.verdict === "raise" && !raised) {
        raised = { item, state: "raised", turnNumber: judgment.turnNumber, cardName: judgment.cardName };
      }
    }
    if (raised) {
      if (choices[item] === "flip") return { ...raised, state: "revealed" };
      if (choices[item] === "hold") return { item, state: "down", everRaised: true };
      return raised;
    }
    return { item, state: "down" };
  });
}

/** 翻开牌的归因标注(spec 故事 4:「第 N 轮,经理用某某策略卡问出」)。 */
export function attributionNote(card: Pick<HiddenCardView, "turnNumber" | "cardName">): string {
  if (card.turnNumber === undefined) return "本局问出来的";
  return card.cardName
    ? `第 ${card.turnNumber} 轮,经理用『${card.cardName}』问出来的`
    : `第 ${card.turnNumber} 轮问出来的`;
}

/** 结算视图:每张牌翻开与否;未翻开的注明经理漏掉的信号。 */
export interface HiddenCardSettled {
  item: string;
  revealed: boolean;
  turnNumber?: number;
  cardName?: string;
  /** 仅未翻开时:经理问到边上(edge)/整局没碰(untouched)。 */
  miss?: "edge" | "untouched";
}

/**
 * 结算揭晓(spec 故事 6):逐条隐藏信息说明经理是否问出——
 * 问到边上没追问 vs 整局没问到。不评价玩家。
 * 方案 B(2026-11-11)起对局中不再有翻/藏操作,choices 缺省为空:
 * 经理问到边上而客户没说出的,一律按 edge 结算。
 */
export function settleHiddenCards(
  items: readonly string[],
  turns: readonly ConversationTurn[],
  cards: readonly StrategyCard[],
  choices: Readonly<Record<string, HiddenCardChoice>> = {},
): HiddenCardSettled[] {
  return deriveHiddenBoard(items, turns, cards, choices).map((card) => {
    if (card.state === "revealed") {
      return { item: card.item, revealed: true, turnNumber: card.turnNumber, cardName: card.cardName };
    }
    return {
      item: card.item,
      revealed: false,
      miss: card.state === "raised" || card.everRaised ? ("edge" as const) : ("untouched" as const),
    };
  });
}

/** 漏掉的信号一句话(结算展示):主语是经理,不涉及玩家表现。 */
export function hiddenMissNote(card: HiddenCardSettled): string {
  return card.miss === "edge" ? "经理问到边上,但没追问下去" : "整局都没问到这个信号";
}

/**
 * 隐藏牌排(工单 04):背面朝下的一排牌 + 进度 x/N;翻牌走 3D 翻转动画,
 * 减少动效偏好时直接切换不播动画;举牌时把待决状态回报给桌宠(表情变 think)。
 */
export function HiddenCards({
  items,
  turns,
  cards,
  choices = {},
  onChoice,
  onRaisePendingChange,
}: {
  items: readonly string[];
  turns: readonly ConversationTurn[];
  cards: readonly StrategyCard[];
  choices?: Readonly<Record<string, HiddenCardChoice>>;
  onChoice?: (item: string, choice: HiddenCardChoice) => void;
  onRaisePendingChange?: (pending: boolean) => void;
}) {
  const board = useMemo(
    () => deriveHiddenBoard(items, turns, cards, choices),
    [items, turns, cards, choices],
  );
  const revealedCount = board.filter((card) => card.state === "revealed").length;
  const raisePending = board.some((card) => card.state === "raised");

  useEffect(() => {
    onRaisePendingChange?.(raisePending);
  }, [raisePending, onRaisePendingChange]);

  return (
    <>
      <ul
        className="hidden-card-row"
        aria-label="隐藏牌"
        data-reduced-motion={reducedMotion() || undefined}
      >
        {board.map((card, index) => (
          <li
            key={`${index}-${card.item}`}
            className="hidden-card"
            data-state={card.state}
            aria-label={
              card.state === "revealed"
                ? `隐藏牌已翻开:${card.item}`
                : card.state === "raised"
                  ? `隐藏牌举牌待决定:${index + 1}`
                  : `隐藏牌扣着:${index + 1}`
            }
          >
            <span className="hidden-card-flip">
              <span className="hidden-card-face hidden-card-back" aria-hidden="true">?</span>
              {/* 牌面只在翻开后渲染原文;扣着/举牌时不露内容。 */}
              <span className="hidden-card-face hidden-card-front">
                {card.state === "revealed" && (
                  <>
                    <span className="hidden-card-text">{card.item}</span>
                    <span className="hidden-card-note">{attributionNote(card)}</span>
                  </>
                )}
              </span>
            </span>
            {card.state === "raised" && (
              <span className="hidden-card-raise">
                <button type="button" className="hidden-card-flip-btn" onClick={() => onChoice?.(card.item, "flip")}>
                  翻
                </button>
                <button type="button" className="hidden-card-hold-btn" onClick={() => onChoice?.(card.item, "hold")}>
                  先藏着
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="hidden-card-progress" aria-live="polite">
        已翻 {revealedCount}/{board.length}
      </p>
    </>
  );
}
