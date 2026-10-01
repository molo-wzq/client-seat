/**
 * 产品事实的运行时守卫:卡外数字检测(确定性,无模型调用)。
 * 策略卡引用有 usedCardId 校验,产品事实此前没有对称机制——真实模型
 * 若说出卡外的"年化3.5%"或"存10万给80块",系统应能如实标注。
 * 只标不拦:与策略卡「未确认」同一哲学,复盘呈现,不改话术不拦对话。
 */

import type { ConversationTurn, VirtualProductCard } from "./types";

/** 数字量词:只抓金额/比例/天数类量词,日期(号/日)与轮次(轮)不抓,避免误报。 */
const UNIT = /万|元|块|%|个点|天/;

/** 带量词数字的匹配:阿拉伯或常见中文数字,允许"来/多"式约数后缀。 */
const NUMBER_WITH_UNIT =
  /([0-9]+(?:\.[0-9]+)?|[一二两三四五六七八九十百千]+(?:点[0-9]+)?)\s*(来|多)?\s*(万|元|块|%|个点|天)/g;

/** 中文数字(一~九千九百九十九)转数值;解析不了返回 null。 */
function parseChineseNumeral(text: string): number | null {
  if (/^[0-9.]+$/.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (!/^[一二两三四五六七八九十百千]+$/.test(text)) return null;
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (char === "十" || char === "百" || char === "千") {
      const unitValue = char === "十" ? 10 : char === "百" ? 100 : 1000;
      current = current === 0 ? unitValue : current * unitValue;
      total += current;
      current = 0;
    } else {
      const value = digits[char];
      if (value === undefined) return null;
      current = current * 10 + value;
    }
  }
  return total + current;
}

interface ExtractedNumber {
  /** 归一后的数值:金额统一折成元(万×10000),比例与天数保持原单位。 */
  canonical: number;
  unit: "yuan" | "percent" | "day";
}

/** 从一段话术里提取带量词的数字并归一。 */
export function extractCardNumbers(text: string): ExtractedNumber[] {
  const results: ExtractedNumber[] = [];
  for (const match of text.matchAll(NUMBER_WITH_UNIT)) {
    const value = parseChineseNumeral(match[1]);
    if (value === null || !Number.isFinite(value)) continue;
    const unit = match[3];
    if (unit === "万") {
      results.push({ canonical: Math.round(value * 10000), unit: "yuan" });
    } else if (unit === "元" || unit === "块") {
      results.push({ canonical: Math.round(value), unit: "yuan" });
    } else if (unit === "%" || unit === "个点") {
      results.push({ canonical: Math.round(value * 10) / 10, unit: "percent" });
    } else {
      results.push({ canonical: value, unit: "day" });
    }
  }
  return results;
}

function numberKey(n: ExtractedNumber): string {
  return `${n.unit}:${n.canonical}`;
}

/** 产品卡事实集:档位金额与权益、参考年化、流动性天数。 */
export function cardFactNumbers(card: VirtualProductCard): Set<string> {
  const facts = [
    card.activity.name,
    card.activity.deadline,
    card.activity.rule,
    ...card.activity.tiers.flatMap((t) => [t.amount, t.reward]),
    card.flexibleProduct.name,
    card.flexibleProduct.type,
    card.flexibleProduct.referenceYield,
    card.flexibleProduct.liquidity,
    card.flexibleProduct.audience,
  ].join(" ");
  return new Set(extractCardNumbers(facts).map(numberKey));
}

/**
 * 经理话术里的数字是否全部有出处:
 * 白名单 = 产品卡事实 ∪ 本局客户口述过的数字 ∪ 此前经理轮已报过的数字(说过的不重复记账)。
 * history 含本轮客户发言在内的此前全部轮次。
 */
export function hasOutOfCardNumber(
  managerReply: string,
  card: VirtualProductCard,
  history: ConversationTurn[],
): boolean {
  const whitelist = cardFactNumbers(card);
  for (const turn of history) {
    for (const n of extractCardNumbers(turn.text)) whitelist.add(numberKey(n));
  }
  return extractCardNumbers(managerReply).some((n) => !whitelist.has(numberKey(n)));
}

/** 供 UI 复用的量词正则说明(卡外数字徽标的提示文案)。 */
export const NUMBER_UNIT_PATTERN_SOURCE = UNIT.source;
