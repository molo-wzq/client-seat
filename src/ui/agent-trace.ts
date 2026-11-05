/**
 * Agent 轨迹归并(工单 15,纯函数):
 * - buildTraceSteps:一条桌宠回复上方「做了什么」的轨迹行步骤——
 *   工单视图给 Worker 名与最新状态,评估记录给规则命中,按同一触发归并;
 * - mergeWorkLog:工作日志时间线,工单与评估记录按时间合并。
 * 数据形状由 agent-contract 钉住(AgentTicketView.triggerId/worker/at)。
 */
import type { AgentEvalRecord, AgentTicketView, ReportStatus } from "../shared/agent-contract";

/** 轨迹行的一步:图标 + 短语 + 展开明细。 */
export interface TraceStep {
  icon: string;
  label: string;
  /** 展开后给人看的明细(规则 id、理由、处置)。 */
  detail?: string;
}

/** 评估处置的中文标签:observe 只记录,auto 已执行。 */
const EVAL_OUTCOME_LABEL: Record<AgentEvalRecord["outcome"], string> = {
  observed: "只记录",
  executed: "已执行",
};

/** 工单状态的轨迹措辞:进展/等待/就绪/受阻/失败/放弃。 */
const STATUS_STEP: Record<ReportStatus, { icon: string; label: string }> = {
  progress: { icon: "⚙️", label: "在跑" },
  waiting: { icon: "⏸", label: "等你拍板" },
  ready: { icon: "✅", label: "办完了" },
  blocked: { icon: "⚠️", label: "受阻了" },
  failed: { icon: "✖️", label: "没办成" },
  dropped: { icon: "⊘", label: "不做了" },
};

/**
 * 一条回复的轨迹步骤:🔍 查了{Worker} → 📋 规则本来会做什么(同一触发) → 状态收尾。
 * 未知工单号或旧数据(缺 worker/triggerId)都给得出可渲染的步骤,不抛错。
 */
export function buildTraceSteps(
  ticketId: string,
  tickets: AgentTicketView[],
  evals: AgentEvalRecord[],
): TraceStep[] {
  const ticket = tickets.find((item) => item.ticketId === ticketId);
  if (!ticket) return [];
  const steps: TraceStep[] = [];
  if (ticket.worker) steps.push({ icon: "🔍", label: `查了${ticket.worker}` });
  for (const record of evals) {
    if (record.triggerId !== ticket.triggerId) continue;
    steps.push({
      icon: "📋",
      label: record.wouldDo,
      detail: `${record.ruleId} · ${record.why} · ${EVAL_OUTCOME_LABEL[record.outcome]}`,
    });
  }
  steps.push(STATUS_STEP[ticket.status]);
  return steps;
}

/** 工作日志的一条:工单或评估记录,带统一时间。 */
export type WorkLogItem =
  | { at: string; kind: "ticket"; ticket: AgentTicketView }
  | { at: string; kind: "eval"; eval: AgentEvalRecord };

/** 工作日志时间线:工单与评估按 at 升序合并;没有 at 的旧工单排最后。 */
export function mergeWorkLog(tickets: AgentTicketView[], evals: AgentEvalRecord[]): WorkLogItem[] {
  const items: WorkLogItem[] = [
    ...tickets.map((ticket): WorkLogItem => ({ at: ticket.at ?? "", kind: "ticket", ticket })),
    ...evals.map((record): WorkLogItem => ({ at: record.at, kind: "eval", eval: record })),
  ];
  // 稳定排序:时间相同保持插入序(工单在前——它先立项,评估随后落账)。
  return items.sort((a, b) => (a.at || "9999").localeCompare(b.at || "9999"));
}
