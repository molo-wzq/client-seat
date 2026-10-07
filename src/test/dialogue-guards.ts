import { expect } from "vitest";
import type { ManagerTurnOutput } from "../domain/ports";

/**
 * 对照案例的结构性断言(dialogue-guardrails spec A):
 * 只做结构与已知规则的确定性检查(问句数/句数/数字来源/否定与条件),
 * 不判断内容语义;"是否接住""话术自然"由真模型基线人工复核。
 */

/** 单轮问句数:问号计 1;「吗」未带问号再计 1(规则 11:一次只问一个问题)。 */
export function countQuestions(reply: string): number {
  const normalized = reply.replace(/吗([？?])/g, "$1");
  const marks = (normalized.match(/[？?]/g) ?? []).length;
  const verbalMa = /吗/.test(normalized) ? 1 : 0;
  return marks + verbalMa;
}

/** 单轮句数:按句末标点切分(规则 1:不超过 3 句)。 */
export function countSentences(reply: string): number {
  return reply
    .split(/[。!！?？…\n]/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function expectAtMostOneQuestion(reply: string): void {
  expect(countQuestions(reply), `问句超过一个:"${reply}"`).toBeLessThanOrEqual(1);
}

export function expectAtMostThreeSentences(reply: string): void {
  expect(countSentences(reply), `句数超过三个:"${reply}"`).toBeLessThanOrEqual(3);
}

/**
 * 资金现状未摸清(去向/金额/期限缺块)时,不报产品数字与权益金额(规则 4):
 * 只禁数字口径(万元/元/百分比);活动与权益的名称属于说清来意(规则 3),不禁。
 */
export function expectNoProductNumbers(reply: string): void {
  expect(reply, `资金现状未摸清即报产品数字:"${reply}"`).not.toMatch(
    /\d+\s*万|\d+\s*元|\d+(?:\.\d+)?%/,
  );
}

/** 收益/权益数字只能来自产品卡:百分比只允许 2%–3% 区间口径,金额只允许卡内分档。 */
export function expectNumbersOnlyFromProductCard(reply: string): void {
  for (const match of reply.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const value = Number(match[1]);
    expect(value, `收益百分比超出产品卡区间:"${reply}"`).toBeGreaterThanOrEqual(1.5);
    expect(value).toBeLessThanOrEqual(3.5);
  }
  // 产品卡只给区间表述:具体点值利率(「大概2.7的利率」)是卡外数字,整数
  // 区间口径(2%到3%)不受影响。
  expect(reply, `出现卡外具体利率点值:"${reply}"`).not.toMatch(
    /\d\.\d+\s*(?:的)?(?:%|年化|利率|收益)/,
  );
}

/**
 * 保本/保证类表述必须带否定:「不能保证本金」「不保本」是合法风险说明,
 * 未否定的「保本」「保证收益」是违规承诺。只查否定窗口,不猜语义。
 * 窗口取 6 字:口语否定常隔几个字(「谁也没法跟您说保本」,「没」在 5 字外)。
 */
export function expectNoUnconditionalGuarantee(reply: string): void {
  for (const match of reply.matchAll(/保本|保证|稳赚|绝对安全|百分之百/g)) {
    const start = match.index ?? 0;
    const before = reply.slice(Math.max(0, start - 6), start);
    expect(
      /不|没|无|非/.test(before),
      `出现未否定的保证性表述 "${match[0]}":"${reply}"`,
    ).toBe(true);
  }
}

/**
 * 活动资格未知时,对客户"能参加"的断言必须落在条件句里:
 * 句内须含 如果/要是/只要/属于/符合/条件/确认/得看 之一(规则 9 三分口径)。
 */
export function expectEligibilityOnlyConditional(reply: string): void {
  const sentences = reply.split(/[。!！?？\n]/).filter((s) => /您|你/.test(s));
  for (const sentence of sentences) {
    if (/(?:您|你)[^。,，!！?？]{0,6}(?:可以|能|符合)[^。,，!！?？]{0,8}(?:参加|报名|领|享受)/.test(sentence)) {
      expect(
        /如果|要是|只要|属于|符合|条件|确认|得看|办了/.test(sentence),
        `资格断言未带条件:"${sentence}"(整段:"${reply}")`,
      ).toBe(true);
    }
  }
}
