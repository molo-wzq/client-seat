import type { AgentTicketView, LedgerEntry } from "./types";

/**
 * 账本视图上的纯函数折叠(工单 05):把只追加的账本折成「每张工单最新一条 Report」。
 * 放在 server/agent 与核心共用一份领域规则;不落账、无副作用,tickets() 每次现算。
 */
export function foldTickets(entries: LedgerEntry[]): AgentTicketView[] {
  const tickets = new Map<string, AgentTicketView>();
  for (const entry of entries) {
    if (entry.type === "ticket") {
      // 刚立项还没有 Report:视为进展中,文案为空,由 UI 给占位。
      tickets.set(entry.ticket.id, { ticketId: entry.ticket.id, status: "progress", text: "" });
    } else if (entry.type === "report") {
      const { ticketId, status, text } = entry.report;
      tickets.set(ticketId, { ticketId, status, text });
    }
  }
  // Map 保持首次立项顺序:列表按工单出现先后排列,最新 Report 原位覆盖。
  return [...tickets.values()];
}
