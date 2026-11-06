/**
 * 前后端共享的桌宠 Agent 通信契约，不依赖 HTTP、Worker 或存储实现。
 * Source → Trigger → Thread → Eval(准入)→ Ticket → Worker → Report → Channel。
 * 编排细节只藏在核心(core.ts)内部,这里只放跨层数据形状。
 */

/** 触发来源:事件从哪个域进入 Agent(spec:table/materials/research/pet/system)。 */
export type AgentSource = "table" | "materials" | "research" | "pet" | "system";

/**
 * 触发类型:同一来源下的事件类别——pet 命令条为 "command",对局结束为 "game-ended"(工单 06),
 * 拖文件到桌宠为 "dropped"(data:{fileName,fileKind}),待审批注为 "annotate"(data:{ticketId,note})(工单 07),
 * 模型报错为 "model-error"(工单 10 补上类型,R5 规则自此可命中;data:{error} 可选),
 * 桌宠对话为 "chat"(工单 11;data:{text,history,view},工单 16 起另带 context:ChatContext,落账前剔除),
 * 周报到期为 "research-due"(工单 11;data:{weekId}),策略卡发布为 "cards-published"(工单 11;data:{materialId,cardIds}),
 * 牌局事件为 "card-played" / "hidden-raised" / "hidden-revealed"(工单 16;data:{gameId,cardId?,cardName?,item?},
 * 由反应 Worker 落成带表情的 dropped Report,驱动桌宠微反应)。
 * 每个 kind 只认所属域的 source(如 research-due 只来自 research),冒名即拒绝。
 */
export type AgentTriggerKind =
  | "command"
  | "game-ended"
  | "dropped"
  | "annotate"
  | "model-error"
  | "chat"
  | "research-due"
  | "cards-published"
  | "card-played"
  | "hidden-raised"
  | "hidden-revealed";

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

/** 评估结论(Eval 的产物):准入 + 研判(工单 08 起受放权模式约束)。 */
export interface AgentDecision {
  triggerId: string;
  admitted: boolean;
  /** 一句话理由(给人读,进账本)。 */
  reason: string;
}

/** 放权模式(工单 08):off 规则命中不评估不执行;observe 只记评估;auto 立项执行。 */
export type AcceptMode = "off" | "observe" | "auto";

/**
 * 主动规则(spec v9 的 R1–R7,写成数据):Agent 会自己发起的候选工作。
 * 按 source+kind 匹配触发;R1–R3 对应现有触发类型,R4–R7 的触发类型由后续工单补上。
 */
export interface AgentPolicyRule {
  id: "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";
  /** 短名(给人读,进 UI)。 */
  name: string;
  source: AgentSource;
  kind: string;
  /** 本来会做什么(一句动宾,进评估记录)。 */
  wouldDo: string;
  /** 为什么(命中理由,进评估记录)。 */
  why: string;
}

/** 放权策略(工单 08):版本号随每次切换递增;规则集本期固定为 R1–R7。 */
export interface AgentPolicy {
  version: number;
  acceptMode: AcceptMode;
  rules: AgentPolicyRule[];
}

/**
 * 研判处置(工单 08):主动规则命中一次记一条,即「评估记录」——
 * observe 只记录(observed),auto 已立项执行(executed);off 不记。
 */
export interface AgentDisposition {
  triggerId: string;
  ruleId: AgentPolicyRule["id"];
  /** 本来会做什么(取自命中规则)。 */
  wouldDo: string;
  /** 为什么(命中理由)。 */
  why: string;
  outcome: "observed" | "executed";
}

/** 评估记录(GET /api/agent/evals 的产物):Disposition 补上账本时间。 */
export interface AgentEvalRecord extends AgentDisposition {
  at: string;
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
 * 桌宠表情(工单 11):模型回复按约定带 [wave|think|cheer|sleepy|pout] 前缀,
 * Worker 剥离后落成结构化字段,前端据此切表情,不进正文。
 */
export type PetEmotion = "wave" | "think" | "cheer" | "sleepy" | "pout";

/**
 * 工单视图(tickets() 的产物):一张工单折叠到最新一条 Report 后的样子。
 * 还没有 Report 的工单视为刚领走(进展、空文案),UI 自行给占位。
 * triggerId/worker/at(工单 15)供轨迹行与工作日志归并用,由账本补齐;旧数据可缺省。
 */
export interface AgentTicketView {
  ticketId: string;
  status: ReportStatus;
  text: string;
  /** 关联触发 id:轨迹行/工作日志按它与评估记录归并。 */
  triggerId?: string;
  /** 干活的 Worker 名(如「对话」「投研」),按触发类型推知。 */
  worker?: string;
  /** 立项时间(ISO 串):工作日志时间线排序。 */
  at?: string;
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
  /**
   * 桌宠表情(工单 11):对话 Worker 剥离模型回复的表情前缀后携带;
   * 其余 Worker 缺省。Report 文本与 delta 共用同一个可注入脱敏出口(默认不处理)。
   */
  emotion?: PetEmotion;
  /**
   * 快捷动作建议(工单 11):对话 Worker 从玩家话里识别出的命令意图,
   * 转成快捷环同名按钮文案由前端渲染;只是建议,不直接执行。
   */
  quickActions?: string[];
}

/** 触发入口的结果；未准入时 ticket/report 为空。 */
export interface EmitOutcome {
  triggerId: string;
  admitted: boolean;
  ticket: AgentTicket | null;
  report: AgentReport | null;
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

/**
 * 牌局快照上下文(工单 16):前端随 chat 触发附带的 `data.context`,
 * 只进桌宠对话 Worker 的提示词(客户侧,可含隐藏牌,ADR 0007),
 * 落账前整个剔除(与 hidden 同一道 S4 机制,见 core.sanitizeTriggerData)。
 * 两态:牌局进行中带牌面与进度;不在牌局时换成所处幕与最近一局摘要。
 */
export type ChatContext = GameChatContext | IdleChatContext;

/** 牌局进行中的快照。 */
export interface GameChatContext {
  phase: "game";
  /** 当前客户角色卡的公开面:姓名与可见字段(经理也能看到的那些)。 */
  customer: { name: string; visible: string[] };
  /** 本局玩家自己的隐藏牌(仅客户侧可见;绝不进经理上下文)。 */
  hiddenCards: string[];
  /** 最近几轮对话,按经理/玩家区分(条数上限见 CHAT_CONTEXT_LIMITS)。 */
  turns: Array<{ speaker: "manager" | "player"; text: string }>;
  /** 经理已出的策略卡及其出处。 */
  cardsPlayed: Array<{ cardId: string; cardName: string; source: string }>;
  /** 当前回合数(经理轮序,从 1 计)与总回合数。 */
  turnNumber: number;
  maxTurns: number;
  /** 已揭示的隐藏牌数(x/N 的 x;N 为 hiddenCards 总数)。 */
  revealedHidden: number;
}

/** 不在牌局时的快照:所处幕与最近一局摘要。 */
export interface IdleChatContext {
  phase: "idle";
  /** 当前所处幕(如「布置」「复盘」)。 */
  act: string;
  /** 最近一局摘要;没有历史时缺省。 */
  lastGame?: { summary: string };
}

/** 快照长度上限(工单 16):前端组装与服务端防御性截断共用同一份。 */
export const CHAT_CONTEXT_LIMITS = {
  /** 最近对话轮数。 */
  turns: 6,
  /** 单条文本字段字符上限(轮次原文、摘要等)。 */
  textChars: 160,
  /** 客户公开面条目上限。 */
  visibleItems: 6,
  /** 隐藏牌条数上限。 */
  hiddenCards: 8,
  /** 经理已出策略卡条数上限(最近的在前也只带这么多)。 */
  cardsPlayed: 12,
} as const;

/** 呈现通道:本期只有桌宠气泡(硬上限 40 字);后续票扩展翻牌动画、待办面板等。 */
export interface AgentChannel {
  target: "pet-bubble";
  ticketId: string;
  /** 不超过 40 字的气泡文案。 */
  text: string;
}

/** 对外事件(subscribe 送达):Report 与 Channel;对话 Worker 另发流式 delta(工单 11)。 */
export type AgentEvent =
  | { type: "report"; report: AgentReport }
  | { type: "channel"; channel: AgentChannel }
  /** 流式增量(工单 11):正文片段,已剥表情前缀;只走事件不落账,结束时另有 ready Report。 */
  | { type: "delta"; ticketId: string; text: string };

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

export interface DispositionEntry extends LedgerRecord {
  type: "disposition";
  disposition: AgentDisposition;
}

/** 账本条目:按 spec 记录 Trigger、Decision、Disposition、Report(本期另记 Ticket)。 */
export type LedgerEntry = TriggerEntry | DecisionEntry | TicketEntry | ReportEntry | DispositionEntry;

/** 追加输入:不含 seq/at,由存储按追加顺序分配。 */
export type LedgerEntryInput = DistributiveOmit<LedgerEntry, "seq" | "at">;

/** Omit 在联合上按成员分发,保持判别联合。 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
