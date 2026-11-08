/**
 * 对话流消息的纯变迁(工单 15,审查 S1/S2/R2):
 * - appendCapped:追加并截到最近 50 条;
 * - mergeDelta:流式增量按工单号拼接,首个增量创建流式条目;
 * - applyChatReport:终态 Report(ready/failed/dropped)定稿,非终态不动消息。
 * 组件只挑调用时机,规则都在这里、单独可测。
 */
import { CHAT_HISTORY_MAX, type PetChatMessage } from "./chat-history";
import type { AgentReport } from "../shared/agent-contract";

/** 追加并截到最近 50 条(渲染与本地存储同一上限)。 */
export function appendCapped(prev: PetChatMessage[], message: PetChatMessage): PetChatMessage[] {
  return [...prev, message].slice(-CHAT_HISTORY_MAX);
}

/**
 * 流式增量:同工单的最后一条消息若在流式中则拼接;已定稿则原位重开流式
 * (真实模型半截报错退回 demo 时,旧文被替换,不拼出两段怪话,审查 R2);
 * 没有则新建流式条目。
 */
export function mergeDelta(
  prev: PetChatMessage[],
  ticketId: string,
  text: string,
  nextKey: () => string,
): PetChatMessage[] {
  const index = findLastTicketIndex(prev, ticketId);
  if (index >= 0) {
    const current = prev[index]!;
    const next = [...prev];
    next[index] = current.streaming
      ? { ...current, text: current.text + text }
      : { ...current, text, streaming: true };
    return next;
  }
  return appendCapped(prev, { key: nextKey(), ticketId, speaker: "pet", text, streaming: true });
}

/**
 * 对话 Report 落消息:终态(ready/failed/dropped)定稿或补一条;
 * ready/failed 后再来的终态覆盖同一条(回退路径先 failed 再 ready 只留一条,审查 S2)。
 * 非终态(progress/waiting/blocked)不动消息——那是待办面板与工作日志的事。
 * 相同终态重复到达时返回原数组(引用不变,幂等)。
 */
export function applyChatReport(
  prev: PetChatMessage[],
  report: AgentReport,
  nextKey: () => string,
): PetChatMessage[] {
  if (report.status !== "ready" && report.status !== "failed" && report.status !== "dropped") return prev;
  const index = findLastTicketIndex(prev, report.ticketId);
  if (index < 0) {
    return appendCapped(prev, {
      key: nextKey(),
      ticketId: report.ticketId,
      speaker: "pet",
      text: report.text,
      ...(report.emotion ? { emotion: report.emotion } : {}),
    });
  }
  const existing = prev[index]!;
  if (!existing.streaming && existing.text === report.text) return prev;
  const next = [...prev];
  next[index] = {
    ...existing,
    text: report.text,
    streaming: undefined,
    ...(report.emotion ? { emotion: report.emotion } : {}),
  };
  return next;
}

/** 该工单最后一条消息的下标(从后往前找,回退重流时旧条目在前也不影响)。 */
function findLastTicketIndex(messages: PetChatMessage[], ticketId: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.ticketId === ticketId) return index;
  }
  return -1;
}
