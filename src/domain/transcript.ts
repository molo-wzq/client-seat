import type { MaterialTurn, Speaker } from "./types";

/**
 * 转写稿解析兜底(spec.md:粘贴的转写稿允许无说话人标注,由分析步骤完成
 * 说话人区分,用户可纠正)。模型适配器返回的轮次优先;本模块仅用于
 * 模型未返回轮次时的兜底与种子数据解析,结果始终允许用户在界面上纠正。
 */

/** 一次说话人区分结果:speaker + 原话;number 为可缺省的转写标注(如 T07)。 */
export interface ParsedTurn {
  speaker: Speaker;
  text: string;
  number?: number;
}

/** 从一行转写中提取「T07 经理:……」式标注;无标注时返回 null 由调用方兜底。 */
function parseLabeledLine(line: string): { turnNumber?: number; speaker?: Speaker; text: string } | null {
  let rest = line;
  let turnNumber: number | undefined;

  const turnMatch = rest.match(/^T?(\d+)\s*[.、:：]?\s*/);
  if (turnMatch) {
    turnNumber = Number(turnMatch[1]);
    rest = rest.slice(turnMatch[0].length);
  }

  // 说话人标签:冒号前不超过 8 个字的短前缀(经理/理财经理/客户A/生客……)。
  const labelMatch = rest.match(/^([^:：]{1,8})[:：]\s*(.*)$/);
  if (labelMatch) {
    const label = labelMatch[1];
    const text = labelMatch[2].trim();
    if (!text) return null;
    if (/经\s*理|坐席|客服|顾问/.test(label)) {
      return { turnNumber, speaker: "manager", text };
    }
    if (/客户|生客|用户/.test(label)) {
      return { turnNumber, speaker: "customer", text };
    }
    // 冒号前不是说话人标签(如“目的是:……”),整行按内容处理。
    return { turnNumber, text: rest.trim() };
  }
  return { turnNumber, text: rest.trim() };
}

/** 解析粘贴转写稿为轮次序列;无标注行按 manager/customer 交替兜底,起始为经理(外呼场景先开口)。 */
export function parseTranscriptTurns(transcript: string): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  let fallbackSpeaker: Speaker = "manager";
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = parseLabeledLine(line) ?? { text: line };
    const speaker: Speaker = parsed.speaker ?? fallbackSpeaker;
    fallbackSpeaker = speaker === "manager" ? "customer" : "manager";
    turns.push({ speaker, text: parsed.text, number: parsed.turnNumber });
  }
  return turns;
}

/**
 * 把说话人区分结果落为素材轮次:轮次序号是策略来源的追溯坐标。
 * 带转写标注(T07)的行保留标注值;否则在上一个序号上加一,保证序号严格递增。
 */
export function numberTurns(turns: ParsedTurn[]): MaterialTurn[] {
  let last = 0;
  return turns.map(({ speaker, text, number }) => {
    const value = typeof number === "number" && Number.isInteger(number) && number > last ? number : last + 1;
    last = value;
    return { number: value, speaker, text };
  });
}

/** 把「T01–T02」「T14」「第3–5句」式轮次区间解析为升序序号数组;无法解析返回空数组。 */
export function parseTurnRange(turnRange: string): number[] {
  const text = turnRange.trim();

  const range = text.match(/T?0*(\d+)\s*[–—~-]\s*T?0*(\d+)/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start <= end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [];
  }

  const single = text.match(/T?0*(\d+)/);
  return single ? [Number(single[1])] : [];
}

/** 按轮次区间取出素材的原始转写片段;素材缺轮次数据时返回空数组。 */
export function resolveTurnRange(turnRange: string, turns: MaterialTurn[]): MaterialTurn[] {
  const numbers = new Set(parseTurnRange(turnRange));
  return turns.filter((turn) => numbers.has(turn.number));
}
