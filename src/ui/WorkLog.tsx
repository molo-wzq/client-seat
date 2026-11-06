import type { WorkLogItem } from "./agent-trace";
import { NO_REPORT_TEXT, TICKET_STATUS_LABEL } from "./TicketCard";

/**
 * 工作日志(工单 15):状态条点开的时间线——工单与评估记录按时间合并
 * (原工单列表与评估记录合并而来),最新在下。定位某张工单时该行高亮。
 */

/** 评估处置标签:observe 只记录,auto 已执行。 */
const EVAL_OUTCOME_LABEL: Record<"observed" | "executed", string> = {
  observed: "只记录",
  executed: "已执行",
};

/** 时间只显时分(账本 at 是 ISO 串,按本地时区取 HH:MM)。 */
function formatTime(at: string): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function WorkLog({
  items,
  highlightTicketId,
}: {
  items: WorkLogItem[];
  /** 要定位到的工作单号(回复里的工单可点,点了跳到这里)。 */
  highlightTicketId?: string;
}) {
  return (
    <div className="desk-pet-log" role="log" aria-label="工作日志">
      {items.length === 0 && <p className="desk-pet-log-empty">还没有动静</p>}
      {items.map((item, index) =>
        item.kind === "ticket" ? (
          <article
            className="desk-pet-log-row"
            key={`${item.kind}-${item.ticket.ticketId}`}
            data-highlight={item.ticket.ticketId === highlightTicketId ? "true" : undefined}
            aria-label={`${TICKET_STATUS_LABEL[item.ticket.status]}：${item.ticket.text || NO_REPORT_TEXT}`}
          >
            <span className="desk-pet-status" data-status={item.ticket.status}>
              {TICKET_STATUS_LABEL[item.ticket.status]}
            </span>
            <span className="desk-pet-log-body">
              {item.ticket.worker ? `${item.ticket.worker}·` : ""}
              {item.ticket.text || NO_REPORT_TEXT}
            </span>
            {item.ticket.at && <span className="desk-pet-log-time">{formatTime(item.ticket.at)}</span>}
          </article>
        ) : (
          <p className="desk-pet-log-row desk-pet-log-eval" key={`${item.kind}-${item.eval.triggerId}-${index}`}>
            <span className="desk-pet-log-meta">
              {item.eval.at && formatTime(item.eval.at)} · {item.eval.ruleId} · {EVAL_OUTCOME_LABEL[item.eval.outcome]}
            </span>
            <span className="desk-pet-log-body">
              {item.eval.wouldDo}——{item.eval.why}
            </span>
          </p>
        ),
      )}
    </div>
  );
}
