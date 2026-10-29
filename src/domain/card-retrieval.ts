import type { ConversationTurn, StrategyCard } from "./types";

/**
 * 世界书式检索注入(LLM_CARD_RETRIEVAL=1 时生效,默认关):
 * 每张策略卡可带字面触发词,按客户最近发言子串匹配决定是否上桌;
 * 没有触发词的卡常驻上桌(对应世界书 constant/蓝灯),旧数据零迁移。
 * 与 triggerSignals 的分工:信号是给模型与裁判看的语义描述,
 * 触发词是客户口中说得出、可以拿来做字面匹配的词。
 */

/** 扫描窗口:最近几条客户发言(含本轮);对应世界书 scan depth。 */
export const CARD_RETRIEVAL_SCAN_TURNS = 2;

export function selectCardsForTurn(
  cards: StrategyCard[],
  history: ConversationTurn[],
  customerText: string,
): StrategyCard[] {
  // 只扫客户发言:触发信号的定义就是客户信号,经理话术不参与匹配。
  const customerUtterances = [
    ...history.filter((turn) => turn.speaker === "customer").map((turn) => turn.text),
    customerText,
  ];
  const scanText = customerUtterances.slice(-CARD_RETRIEVAL_SCAN_TURNS).join("\n").toLowerCase();
  return cards.filter((card) => {
    const keywords = (card.triggerKeywords ?? []).map((word) => word.trim().toLowerCase()).filter(Boolean);
    // 无触发词=常驻上桌:发布早于本机制的卡不因检索开关而消失。
    if (keywords.length === 0) return true;
    return keywords.some((word) => scanText.includes(word));
  });
}
