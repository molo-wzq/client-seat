import type { AgentTicketView } from "../shared/agent-contract";

/**
 * 待拍板卡(工单 15):waiting 工单插进对话流,「同意」「驳回」直接拍板,
 * 「改一改」进入引用态——接着在输入框说的一句话就是这条工单的批注(批注表单已删)。
 * blocked 工单只读展示原因,没有按钮。
 */

/** 刚领走还没汇报的工单给的占位文案。 */
export const NO_REPORT_TEXT = "刚领走，还没汇报";

/** 状态徽标文案(spec 故事 10:进展、等待、就绪、受阻、失败;放弃补全)。 */
export const TICKET_STATUS_LABEL: Record<AgentTicketView["status"], string> = {
  progress: "进展",
  waiting: "等待",
  ready: "就绪",
  blocked: "受阻",
  failed: "失败",
  dropped: "已放弃",
};

export function TicketCard({
  ticket,
  onApprove,
  onReject,
  onRevise,
  quoting,
}: {
  ticket: AgentTicketView;
  /** 「同意」:把决定作为 Trigger 发回 Router(spec 故事 11)。 */
  onApprove: (ticketId: string) => void;
  /** 「驳回」:同上。 */
  onReject: (ticketId: string) => void;
  /** 「改一改」:选中这张卡,输入框上方出现引用条。 */
  onRevise: (ticketId: string) => void;
  /** 这张卡是否正被引用(批注态)。 */
  quoting: boolean;
}) {
  const text = ticket.text || NO_REPORT_TEXT;
  if (ticket.status === "blocked") {
    return (
      <article
        className="desk-pet-card"
        data-status="blocked"
        data-ticket-id={ticket.ticketId}
        role="article"
        aria-label={`受阻：${text}`}
      >
        <span className="desk-pet-status" data-status="blocked">
          {TICKET_STATUS_LABEL.blocked}
        </span>
        <p className="desk-pet-card-text">{text}</p>
      </article>
    );
  }
  return (
    <article
      className="desk-pet-card"
      data-status="waiting"
      data-ticket-id={ticket.ticketId}
      data-quoting={quoting || undefined}
      role="article"
      aria-label={`待拍板：${text}`}
    >
      <p className="desk-pet-card-text">
        <span className="desk-pet-status" data-status="waiting">
          {TICKET_STATUS_LABEL.waiting}
        </span>
        {text}
      </p>
      <div className="desk-pet-card-actions">
        <button type="button" onClick={() => onApprove(ticket.ticketId)}>
          同意
        </button>
        <button type="button" onClick={() => onReject(ticket.ticketId)}>
          驳回
        </button>
        <button type="button" className="desk-pet-card-revise" aria-pressed={quoting || undefined} onClick={() => onRevise(ticket.ticketId)}>
          {quoting ? "正在改这版" : "改一改"}
        </button>
      </div>
    </article>
  );
}
