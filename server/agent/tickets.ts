import type { AgentTicketView, AgentTrigger, LedgerEntry } from "./types";

/**
 * 账本视图上的纯函数折叠(工单 05):把只追加的账本折成「每张工单最新一条 Report」。
 * 放在 server/agent 与核心共用一份领域规则;不落账、无副作用,tickets() 每次现算。
 * 工单 15 起补齐 triggerId/worker/at:轨迹行与工作日志据此归并,Report 更新原位保留。
 */

/** Worker 名按触发类型推知(工单 15 轨迹行「查了X」):与编排层的 Worker 分工一一对应。 */
const WORKER_LABELS: Record<AgentTrigger["kind"], string> = {
  command: "命令",
  chat: "对话",
  annotate: "批注",
  "game-ended": "复盘",
  dropped: "素材",
  "cards-published": "盲区",
  "model-error": "报错处置",
  "research-due": "投研",
};

export function foldTickets(entries: LedgerEntry[]): AgentTicketView[] {
  const triggers = new Map<string, AgentTrigger>();
  const tickets = new Map<string, AgentTicketView>();
  for (const entry of entries) {
    if (entry.type === "trigger") {
      triggers.set(entry.trigger.id, entry.trigger);
    } else if (entry.type === "ticket") {
      // 刚立项还没有 Report:视为进展中,文案为空,由 UI 给占位。
      const trigger = triggers.get(entry.ticket.triggerId);
      tickets.set(entry.ticket.id, {
        ticketId: entry.ticket.id,
        status: "progress",
        text: "",
        triggerId: entry.ticket.triggerId,
        ...(trigger ? { worker: WORKER_LABELS[trigger.kind] } : {}),
        at: entry.at,
      });
    } else if (entry.type === "report") {
      const { ticketId, status, text } = entry.report;
      const base = tickets.get(ticketId);
      // 归并字段在立项时定型,Report 更新只覆盖状态与文案。
      tickets.set(ticketId, {
        ticketId,
        status,
        text,
        ...(base?.triggerId ? { triggerId: base.triggerId } : {}),
        ...(base?.worker ? { worker: base.worker } : {}),
        ...(base?.at ? { at: base.at } : {}),
      });
    }
  }
  // Map 保持首次立项顺序:列表按工单出现先后排列,最新 Report 原位覆盖。
  return [...tickets.values()];
}
