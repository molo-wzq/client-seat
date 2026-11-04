/**
 * 桌宠 Agent 领域类型(spec 实现决策,对齐 dsh 领域模型):
 * Source → Trigger → Thread → Eval(准入)→ Ticket → Worker → Report → Channel。
 * 编排细节只藏在核心(core.ts)内部,这里只放跨层数据形状。
 */

/** 触发来源:事件从哪个域进入 Agent(spec:table/materials/research/pet/system)。 */
export type AgentSource = "table" | "materials" | "research" | "pet" | "system";

/** 触发类型:同一来源下的事件类别——pet 命令条为 "command",对局结束为 "game-ended"(工单 06)。 */
export type AgentTriggerKind = "command" | "game-ended";

/** 触发:一次可感知的事件或命令,进入链路的唯一输入。 */
export interface AgentTrigger {
  id: string;
  source: AgentSource;
  kind: AgentTriggerKind;
  /** 命令文本或事件负载;仅约束为 JSON 对象,内容由 kind 约定。 */
  data: Record<string, unknown>;
}

/** emitTrigger 的输入:id 由核心分配,调用方只描述事件本身。 */
export type AgentTriggerInput = Omit<AgentTrigger, "id">;

/**
 * 线程:同一业务对象上的工作上下文,后续工单按此归并事件。
 * 键类型对齐 spec 的 Thread 键:gameId/materialId/personaId/weekId/commandId。
 */
export interface AgentThread {
  kind: "gameId" | "materialId" | "personaId" | "weekId" | "commandId";
  key: string;
}

/** 评估结论(Eval 的产物):本期只做准入;研判与放权模式见后续票。 */
export interface AgentDecision {
  triggerId: string;
  admitted: boolean;
  /** 一句话理由(给人读,进账本)。 */
  reason: string;
}

/** 工单:一次被准予执行的工作,由 Worker 领走。 */
export interface AgentTicket {
  id: string;
  triggerId: string;
  thread: AgentThread;
}

/** 工单汇报状态(spec:progress/waiting/ready/blocked/failed/dropped)。 */
export type ReportStatus = "progress" | "waiting" | "ready" | "blocked" | "failed" | "dropped";

/**
 * 工单视图(tickets() 的产物):一张工单折叠到最新一条 Report 后的样子。
 * 还没有 Report 的工单视为刚领走(进展、空文案),UI 自行给占位。
 */
export interface AgentTicketView {
  ticketId: string;
  status: ReportStatus;
  text: string;
}

/** 汇报:Worker 对一张工单的一次产出;ready 即最终结果。 */
export interface AgentReport {
  ticketId: string;
  status: ReportStatus;
  /** 一句话结果或进展(给人读)。 */
  text: string;
  /**
   * 结构化依据(工单 06):只有需要「展开看依据」的 ready Report 携带,
   * 目前是复盘一句话;结算页插槽据此渲染轮次与策略卡。
   */
  basis?: PostgameBasis;
}

/** 复盘一句话的依据(spec 故事 7「展开」):第几轮 + 该轮用的策略卡。 */
export interface PostgameBasis {
  /** 对局号(Thread 键),结算页据此对上本局。 */
  gameId: string;
  /** 经理轮序,从 1 计。 */
  turnNumber: number;
  /** 该轮经理所用策略卡 id;未用卡时缺省。 */
  cardId?: string;
}

/** 呈现通道:本期只有桌宠气泡(硬上限 40 字);后续票扩展翻牌动画、待办面板等。 */
export interface AgentChannel {
  target: "pet-bubble";
  ticketId: string;
  /** 不超过 40 字的气泡文案。 */
  text: string;
}

/** 对外事件(subscribe 送达):Report 与 Channel,前端只读这两类。 */
export type AgentEvent =
  | { type: "report"; report: AgentReport }
  | { type: "channel"; channel: AgentChannel };

/** 账本条目公共部分:seq/at 由存储在追加时分配,账本只追加、不可改写。 */
interface LedgerRecord {
  seq: number;
  at: string;
}

export interface TriggerEntry extends LedgerRecord {
  type: "trigger";
  trigger: AgentTrigger;
}

export interface DecisionEntry extends LedgerRecord {
  type: "decision";
  decision: AgentDecision;
}

export interface TicketEntry extends LedgerRecord {
  type: "ticket";
  ticket: AgentTicket;
}

export interface ReportEntry extends LedgerRecord {
  type: "report";
  report: AgentReport;
}

/** 账本条目:按 spec 记录 Trigger、Decision、Report(本期另记 Ticket;Disposition 见后续票)。 */
export type LedgerEntry = TriggerEntry | DecisionEntry | TicketEntry | ReportEntry;

/** 追加输入:不含 seq/at,由存储按追加顺序分配。 */
export type LedgerEntryInput = DistributiveOmit<LedgerEntry, "seq" | "at">;

/** Omit 在联合上按成员分发,保持判别联合。 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
