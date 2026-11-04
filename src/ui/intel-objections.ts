import type { Conversation } from "../domain/types";

/**
 * 情报档案夹 → 对局联动:玩家在布置幕把本周真实客户异议「甩给经理」,
 * 开局后作为客户快捷回复出现。只进客户侧,不进经理提示词,
 * 不给经理喂任何投研事实数字。存本机 localStorage,跨局保留,可随时撤回。
 */
const KEY = "client-seat:armed-objections";
const LIMIT = 2;
const listeners = new Set<() => void>();

/** 周报原文常写作「客户说：「……」」,快捷回复只取客户原话本身。 */
export function objectionLine(question: string): string {
  const quoted = question.match(/[「“"]([^」”"]+)[」”"]/);
  return (quoted?.[1] ?? question.replace(/^客户(?:说|问)[:：]\s*/, "")).trim();
}

export function getArmedObjections(): string[] {
  try {
    const raw = window.localStorage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

function save(next: string[]) {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(next.slice(0, LIMIT)));
  } catch {
    // 隐私模式等存储不可用时静默放弃,联动不是关键路径
  }
  listeners.forEach((fn) => fn());
}

/** 甩出/收回一句异议;超过上限时挤掉最早甩出的那句。 */
export function toggleArmedObjection(line: string): string[] {
  const current = getArmedObjections();
  const next = current.includes(line) ? current.filter((x) => x !== line) : [...current, line].slice(-LIMIT);
  save(next);
  return next;
}

export function subscribeArmedObjections(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 经理开口后才出现:接通那一刻客户不会先抛异议。已说过的不再重复给。 */
export function armedObjectionChips(conversation: Conversation | null): string[] {
  const turns = conversation?.turns ?? [];
  if (!turns.some((t) => t.speaker === "manager")) return [];
  const said = new Set(turns.filter((t) => t.speaker === "customer").map((t) => t.text.trim()));
  return getArmedObjections().filter((line) => !said.has(line));
}

export const ARMED_OBJECTION_LIMIT = LIMIT;
