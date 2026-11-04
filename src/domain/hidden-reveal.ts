/**
 * 隐藏牌揭示判定(工单 04,spec 故事 4/5;术语见 CONTEXT「隐藏牌/翻牌/举牌」):
 * 生客画像 hidden 每条一张牌,按一轮「客户发言 × 经理话术」判定三种结果——
 * 客户已说出 → reveal(自动翻牌);经理问到边上、客户没说 → raise(举牌,
 * 由玩家点「翻」或「先藏着」);其余 → none。
 *
 * 这是 demo 适配器(工单 11 换真实模型):口径为子串匹配——
 * 话术与隐藏条目共享一段 ≥3 字的连续片段(含「15万」这类带单位数字)即算说到。
 * 只在客户侧(前端/本局记录)运行;结果绝不进入经理会话(隔离见 prompts 测试)。
 */

/** 每张牌的判定结果:翻 / 举 / 不动。 */
export type HiddenCardVerdict = "reveal" | "raise" | "none";

/** 一轮对局输入:该经理轮的话术、它回应的客户发言,以及归因用的轮次与用卡。 */
export interface RevealTurnInput {
  managerText: string;
  customerText: string;
  /** 经理轮序,从 1 计(牌面标注「第 N 轮」)。 */
  turnNumber?: number;
  /** 该经理轮所用策略卡;未用卡时缺省。 */
  cardId?: string;
  cardName?: string;
}

/** 单张隐藏牌的判定:verdict 非 none 时带归因(轮次、策略卡)。 */
export interface HiddenCardJudgment {
  /** 隐藏牌原文(生客画像 hidden 条目)。 */
  item: string;
  verdict: HiddenCardVerdict;
  /** 归因:判定发生在第几个经理轮。 */
  turnNumber?: number;
  /** 归因:该轮经理所用策略卡 id。 */
  cardId?: string;
  /** 归因:该轮经理所用策略卡名(牌面直接展示)。 */
  cardName?: string;
}

/** demo 匹配的最短共享片段长度:3 字可挡住「银行/资金」这类泛词,放进「15万」这类数字。 */
const MIN_SHARED_CHARS = 3;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/** 话术与隐藏条目是否共享一段 ≥3 字的连续片段。 */
function mentionsSignal(utterance: string, item: string): boolean {
  const said = normalize(utterance);
  const signal = normalize(item);
  for (let i = 0; i + MIN_SHARED_CHARS <= signal.length; i += 1) {
    if (said.includes(signal.slice(i, i + MIN_SHARED_CHARS))) return true;
  }
  return false;
}

export function judgeReveal(hiddenItems: readonly string[], turn: RevealTurnInput): HiddenCardJudgment[] {
  const attribution =
    turn.turnNumber === undefined && turn.cardId === undefined && turn.cardName === undefined
      ? {}
      : {
          ...(turn.turnNumber === undefined ? {} : { turnNumber: turn.turnNumber }),
          ...(turn.cardId === undefined ? {} : { cardId: turn.cardId }),
          ...(turn.cardName === undefined ? {} : { cardName: turn.cardName }),
        };
  return hiddenItems.map((item) => {
    // 客户先说出优先于经理问到:同一轮两边都碰到了,按翻牌(reveal)计。
    if (mentionsSignal(turn.customerText, item)) return { item, verdict: "reveal", ...attribution };
    if (mentionsSignal(turn.managerText, item)) return { item, verdict: "raise", ...attribution };
    return { item, verdict: "none" };
  });
}
