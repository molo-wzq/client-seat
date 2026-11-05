/**
 * 牌局快照组装(工单 16):把 App 手头的牌局状态折成 ChatContext,
 * 随 chat 触发给桌宠对话 Worker(只进桌宠提示词,落账前剔除,见 agent-contract)。
 * 纯函数:字段取舍与长度上限都在这里,App 只喂状态。
 * 隐藏牌是玩家这一侧的私有信息(ADR 0007),只随快照给桌宠,绝不进经理上下文。
 */
import { CHAT_CONTEXT_LIMITS, type ChatContext } from "../shared/agent-contract";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import { deriveHiddenBoard, type HiddenCardChoice } from "./HiddenCards";
import type { Conversation, StrategyCard } from "../domain/types";

/** 组装输入:App 现成的状态,不另造数据形状。 */
export interface PetGameContextInput {
  /** 当前页面(setup/table/postgame/…,映射为「布置/对局/复盘…」)。 */
  view: string;
  /** 当前对局(含开局快照 resources:画像与用卡);不在对局时为 null。 */
  conversation: Conversation | null;
  /** 玩家对举牌的二选一(按局归档,App 的 hiddenChoicesByCall[conversation.id])。 */
  hiddenChoices: Readonly<Record<string, HiddenCardChoice>>;
  /** 最近一局结局(结算页或历史里取);没有历史时 null。 */
  lastGame: { outcome: string; endReason: string } | null;
}

/** 页面名 → 幕名(与 LeftRail 的导航一致,快照里只写给人/模型看的幕)。 */
const ACT_LABELS: Record<string, string> = {
  setup: "布置",
  table: "对局",
  postgame: "复盘",
  materials: "素材库",
  cards: "牌库",
  roles: "角色",
  research: "投研",
  history: "记录",
};

/** 按字符截断(emoji 等增补平面字符不劈半),与契约上限同源。 */
function clampText(text: string, maxChars: number): string {
  return [...text].slice(0, maxChars).join("");
}

/** 最近几轮对话:客户→玩家、经理→经理,带最近 CHAT_CONTEXT_LIMITS.turns 轮。 */
function recentTurns(conversation: Conversation): GameTurns {
  return conversation.turns
    .slice(-CHAT_CONTEXT_LIMITS.turns)
    .map((turn) => ({
      speaker: turn.speaker === "manager" ? ("manager" as const) : ("player" as const),
      text: clampText(turn.text, CHAT_CONTEXT_LIMITS.textChars),
    }));
}

type GameTurns = Array<{ speaker: "manager" | "player"; text: string }>;

/** 经理已出的策略卡及其出处:同一张卡只记一次;查不到的卡出处写「未知」(CONTEXT 书写约定)。 */
function cardsPlayed(conversation: Conversation): Array<{ cardId: string; cardName: string; source: string }> {
  const cards: StrategyCard[] = conversation.resources?.cards ?? [];
  const byId = new Map(cards.map((card) => [card.id, card]));
  const played: Array<{ cardId: string; cardName: string; source: string }> = [];
  for (const turn of conversation.turns) {
    if (turn.speaker !== "manager" || !turn.usedCardId) continue;
    if (played.some((item) => item.cardId === turn.usedCardId)) continue;
    const card = byId.get(turn.usedCardId);
    played.push({
      cardId: turn.usedCardId,
      cardName: card?.name ?? turn.usedCardId,
      source: card
        ? `${card.sourceExcerpt.materialTitle} ${card.sourceExcerpt.turnRange}`
        : "未知",
    });
  }
  return played.slice(-CHAT_CONTEXT_LIMITS.cardsPlayed);
}

/** 已揭示的隐藏牌数:自动翻牌 + 玩家亲手翻的,都算(x/N 的 x)。 */
function revealedHiddenCount(conversation: Conversation, choices: Readonly<Record<string, HiddenCardChoice>>): number {
  const persona = conversation.resources?.persona;
  if (!persona || persona.hidden.length === 0) return 0;
  return deriveHiddenBoard(persona.hidden, conversation.turns, conversation.resources?.cards ?? [], choices).filter(
    (card) => card.state === "revealed",
  ).length;
}

/** 组装牌局快照:牌局进行中带牌面与进度;否则换成所处幕与最近一局摘要。 */
export function buildPetChatContext(input: PetGameContextInput): ChatContext | null {
  const { view, conversation, hiddenChoices, lastGame } = input;
  if (view === "table" && conversation?.status === "ongoing") {
    const persona = conversation.resources?.persona;
    if (!persona) return null;
    return {
      phase: "game",
      customer: {
        name: persona.name,
        visible: persona.visible.slice(0, CHAT_CONTEXT_LIMITS.visibleItems).map((item) => clampText(item, CHAT_CONTEXT_LIMITS.textChars)),
      },
      hiddenCards: persona.hidden.slice(0, CHAT_CONTEXT_LIMITS.hiddenCards).map((item) => clampText(item, CHAT_CONTEXT_LIMITS.textChars)),
      turns: recentTurns(conversation),
      cardsPlayed: cardsPlayed(conversation),
      turnNumber: conversation.turns.filter((turn) => turn.speaker === "manager").length,
      maxTurns: MAX_MANAGER_TURNS,
      revealedHidden: revealedHiddenCount(conversation, hiddenChoices),
    };
  }
  const idle: ChatContext = { phase: "idle", act: ACT_LABELS[view] ?? view };
  if (lastGame) {
    const summary = clampText(`结局:${lastGame.outcome};收口原因:${lastGame.endReason}`, CHAT_CONTEXT_LIMITS.textChars);
    return { ...idle, lastGame: { summary } };
  }
  return idle;
}

/**
 * 最近一局结局(给 idle 快照的摘要源):结算页在手用它;
 * 否则从历史里找最近一通有结局摘要的;都没有 → null(快照只带幕)。
 */
export function lastGameOf(
  result: { outcome: string; endReason: string } | null,
  conversations: ReadonlyArray<Conversation>,
): { outcome: string; endReason: string } | null {
  if (result) return result;
  const ended = conversations.find((item) => item.status === "ended" && item.outcomeSummary);
  return ended ? { outcome: ended.outcomeSummary ?? "未知", endReason: ended.endReason || "未知" } : null;
}
