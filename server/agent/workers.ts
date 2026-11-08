import type { AgentWorker, WorkerRunOptions } from "./core";
import { DemoWorker } from "./workers/demo";
import type { AgentReport, AgentTicket, AgentTrigger } from "./types";
import { classifyModelError, errorMessage, maskModelSecrets } from "../../src/adapters/model-errors";
import type { PetPersonaCard } from "./pet-persona";
import { CHAT_CONTEXT_LIMITS, type ChatContext } from "../../src/shared/agent-contract";

/**
 * 真实模型 Worker:投研/盲区只产 waiting 草稿,人审闸门不变(ADR 0007)。
 * 玩家对小贝说的话不在这里处理,走 pet-bot 的同一段会话。
 * kind chat 若还被送进来,只落一条 dropped,不调用模型、不给建议按钮。
 */

/** 模型端口:OpenAI 兼容流式补全的最小形状(server/main.ts 用现有适配器实现)。 */
export interface AgentModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant 轮携带(工单 16):模型发起的工具调用。 */
  toolCalls?: AgentToolCall[];
  /** tool 轮携带:对应的调用 id 与工具名。 */
  toolCallId?: string;
  name?: string;
}

/** 模型发起的一次工具调用(OpenAI tools 形状的最小集)。 */
export interface AgentToolCall {
  id: string;
  name: string;
  /** 参数 JSON 字符串(模型原样,Worker 解析)。 */
  arguments: string;
}

/** 带工具的补全结果(工单 16):正文或一批工具调用,二选一。 */
export type AgentToolResult =
  | { type: "text"; text: string }
  | { type: "tool_calls"; calls: AgentToolCall[] };

/** OpenAI function calling 的工具定义。 */
export interface AgentToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentModelPort {
  /** 流式补全:onDelta 逐段回调增量,resolve 完整正文(含可能的表情前缀)。 */
  completeStream(messages: AgentModelMessage[], onDelta?: (delta: string) => void): Promise<string>;
  /**
   * 非流式带工具补全(工单 16):模型可选实现;未实现时对话 Worker 不带工具直答。
   * 适配器层负责把 toolCalls/tool 消息映射到 OpenAI 线格式。
   */
  completeWithTools?(messages: AgentModelMessage[], tools: AgentToolSpec[]): Promise<AgentToolResult>;
}

/**
 * 只读工具的数据源(工单 16):组合根注入真实实现(投研 JSON、素材库、历史对局);
 * 缺省空实现——查不到就如实说查不到,不编数据。异步:素材库/历史要过存储。
 */
export interface PetToolSources {
  /** get_weekly_research:本周投研情报卡(情报档案夹的数据源)。 */
  weeklyResearch(): Promise<string>;
  /** search_cards:按关键词查策略卡,返回卡面与原始通话片段出处。 */
  searchCards(keyword: string): Promise<string>;
  /** get_last_review:上一局复盘摘要。 */
  lastReview(): Promise<string>;
}

/** 草稿长度上限:待办卡片可展开读,超长截断防失控。 */
const DRAFT_MAX_CHARS = 500;

/** 防御性取字符串:undefined/非字符串都归空。 */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 防御性取字符串数组。 */
function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** 按字符截断(emoji 等增补平面字符不劈半)。 */
function truncateChars(text: string, maxChars: number): string {
  return [...text].slice(0, maxChars).join("");
}

/**
 * 脱敏出口(S4):delta 逐段与 Report 全文共用同一个函数,组合根注入实现
 * (如按 gameId 自取隐藏牌做替换);默认不做处理。逐段调用、无跨段状态,
 * 需要跨分片匹配的脱敏由注入方自行缓冲。
 */
export type TextRedactor = (text: string) => string;


/** 防御性取字符串数组(快照字段用):非字符串条目丢弃,条数与单条长度截到上限。 */
function textList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .slice(0, maxItems)
    .map((item) => truncateChars(item, CHAT_CONTEXT_LIMITS.textChars));
}

/**
 * 牌局快照渲染(工单 16):把 data.context 渲染成提示词里的一段「牌局快照」。
 * 桌宠坐客户一侧(ADR 0007),快照含玩家隐藏牌——只进桌宠提示词,绝不进经理上下文;
 * 形状不对整体忽略(快照是增强不是依赖),长度按 CHAT_CONTEXT_LIMITS 截断。
 */
export function renderChatContext(context: ChatContext): string {
  if (context.phase === "idle") {
    const summary = context.lastGame ? truncateChars(context.lastGame.summary, CHAT_CONTEXT_LIMITS.textChars) : "";
    return [
      "## 牌局快照(不在牌局)",
      `当前所处幕:${truncateChars(context.act, 20)}`,
      ...(summary ? [`最近一局:${summary}`] : []),
    ].join("\n");
  }
  const turns = context.turns
    .slice(-CHAT_CONTEXT_LIMITS.turns)
    .map((turn) => `${turn.speaker === "manager" ? "经理" : "玩家"}:${truncateChars(turn.text, CHAT_CONTEXT_LIMITS.textChars)}`)
    .filter((line) => !line.endsWith(":"));
  const cards = context.cardsPlayed
    .slice(-CHAT_CONTEXT_LIMITS.cardsPlayed)
    .map((card) => `${card.cardName}(出处:${truncateChars(card.source, 60)})`)
    .filter((line) => !line.startsWith("(出处:"));
  return [
    "## 牌局快照(进行中)",
    `客户公开面:${context.customer.name}${textList(context.customer.visible, CHAT_CONTEXT_LIMITS.visibleItems).join(";")}`,
    `玩家隐藏牌(只有你这一侧知道,绝不向经理透露):${textList(context.hiddenCards, CHAT_CONTEXT_LIMITS.hiddenCards).join(";")}`,
    `回合进度:第 ${context.turnNumber}/${context.maxTurns} 轮;已揭示隐藏牌 ${context.revealedHidden}/${context.hiddenCards.length}`,
    ...(turns.length > 0 ? [`最近对话:\n${turns.join("\n")}`] : []),
    ...(cards.length > 0 ? [`经理已出的策略卡:${cards.join("、")}`] : []),
    ...(context.focusTurn?.text
      ? [`当前经理原话(第 ${context.focusTurn.turnNumber} 轮):${truncateChars(context.focusTurn.text, CHAT_CONTEXT_LIMITS.textChars)}`]
      : []),
  ].join("\n");
}


/** 草稿 Worker(投研/盲区):模型起草或 demo 兜底,一律停在 waiting 等人审。 */
class DraftWorker implements AgentWorker {
  constructor(
    private readonly deps: {
      model?: AgentModelPort;
      demoText: string;
      system: string;
      user: (trigger: AgentTrigger) => string;
    },
  ) {}

  async run(ticket: AgentTicket, trigger: AgentTrigger, options: WorkerRunOptions): Promise<AgentReport> {
    const { onReport } = options;
    if (!this.deps.model) {
      return { ticketId: ticket.id, status: "waiting", text: this.deps.demoText };
    }
    try {
      const draft = await this.deps.model.completeStream([
        { role: "system", content: this.deps.system },
        { role: "user", content: this.deps.user(trigger) },
      ]);
      return { ticketId: ticket.id, status: "waiting", text: truncateChars(draft.trim(), DRAFT_MAX_CHARS) };
    } catch (error) {
      // 同 S5:Report 只写中文短码,原文(掩密钥)只进服务端日志;非 Error 也不二次抛错。
      const code = classifyModelError(error);
      console.warn(`[agent] 草稿模型失败(${code}):${maskModelSecrets(errorMessage(error))}`);
      await onReport({
        ticketId: ticket.id,
        status: "failed",
        text: `真实模型没接上：${code}。先用演示草稿顶上。`,
      });
      return { ticketId: ticket.id, status: "waiting", text: this.deps.demoText };
    }
  }
}


/**
 * 审批落地缝(工单 16):玩家同意草稿后写进哪个数据源;组合根注入真实实现
 * (report-parser 的异议包、agent/review-queue 的人审队列)。缺省空实现:
 * 状态照常流转,只是没落地(纯测试/未接线环境)。
 */
export interface ApprovalSinks {
  /** 同意投研草稿:写入本周投研的异议包(情报档案夹可见)。 */
  fileResearch(draft: string): void | Promise<void>;
  /** 同意盲区草稿:进策略卡人审队列(不直接上牌库,ADR 0007 闸门不变)。 */
  queueBlindspot(draft: string): void | Promise<void>;
}

/** 决议命令(工单 15→16):「同意/驳回 [工单号] [理由]」,理由可选。 */
const DECISION_COMMAND = /^(同意|驳回)\s*(\S+)?(?:\s+(.+))?$/;

/** 是否决议命令:createModelWorkers 据此把命令路由给审批 Worker。 */
export function isDecisionCommand(text: string): boolean {
  return DECISION_COMMAND.test(text.trim());
}

/**
 * 审批 Worker(工单 16):把「同意/驳回」闭环到真实数据源——
 * 同意投研 → 异议包;同意盲区 → 人审队列;驳回 → 归档附理由。
 * 每个动作都先落目标工单的 Report(落账),决定工单自己再回玩家一句。
 * 找目标与失效保护沿用 demo 决议的口径(显式 ID 失效不误审另一张)。
 */
class DecisionWorker implements AgentWorker {
  constructor(private readonly deps: { approvals?: ApprovalSinks }) {}

  async run(ticket: AgentTicket, trigger: AgentTrigger, options: WorkerRunOptions): Promise<AgentReport> {
    const { onReport, context = { tickets: async () => [] } } = options;
    const text = asText(trigger.data.text).trim();
    const match = DECISION_COMMAND.exec(text);
    if (!match) return { ticketId: ticket.id, status: "ready", text: "收到，马上办" };
    const [, verb, ticketId, reason] = match;
    const waiting = (await context.tickets()).filter((view) => view.status === "waiting");
    // 显式 ID 失效时不可审批另一张工单;只有省略 ID 才取最近待办。
    const target =
      ticketId === undefined
        ? waiting.at(-1)
        : waiting.find((view) => view.ticketId === ticketId);
    if (target === undefined) {
      return { ticketId: ticket.id, status: "ready", text: "现在没有等你拍板的工单。" };
    }
    if (verb === "驳回") {
      await onReport({
        ticketId: target.ticketId,
        status: "dropped",
        text: `草稿已归档。理由:${reason ?? "未说明"}`,
      });
      return { ticketId: ticket.id, status: "ready", text: "已驳回，草稿归档。" };
    }
    // 同意:按目标来源闭环(工单视图的 worker 名,来源=触发类型)。
    if ((target.worker === "投研" || target.worker === "盲区") && !this.deps.approvals) {
      return { ticketId: ticket.id, status: "failed", text: "共享档案写入未开放，草稿仍待审。" };
    }
    if (target.worker === "投研") {
      await this.deps.approvals?.fileResearch(target.text);
      await onReport({ ticketId: target.ticketId, status: "ready", text: "已放进本周档案夹（桌宠起草·已审）。" });
      return { ticketId: ticket.id, status: "ready", text: "已放进本周档案夹，随时能查。" };
    }
    if (target.worker === "盲区") {
      await this.deps.approvals?.queueBlindspot(target.text);
      await onReport({ ticketId: target.ticketId, status: "ready", text: "已进策略卡人审队列，上不上牌仍由人定。" });
      return { ticketId: ticket.id, status: "ready", text: "已进人审队列，过了人工这关才上牌。" };
    }
    await onReport({ ticketId: target.ticketId, status: "ready", text: "收到，按你拍板的出结果。" });
    return { ticketId: ticket.id, status: "ready", text: "好，已照办。" };
  }
}

/** 投研草稿系统提示:产出的只是草稿,上不上桌由人审决定。 */
const RESEARCH_DRAFT_SYSTEM =
  "你是投研助理。把到期的周报整理成本周要点草稿:三个要点、一条风险提示。这只是草稿,等待人工审核,不会直接发布。";

/** 盲区草稿系统提示:同上,只分析、只起草。 */
const BLINDSPOT_DRAFT_SYSTEM =
  "你是打法分析师。对新发布的策略卡做盲区分析草稿:两到三条盲区,每条一句话。这只是草稿,等待人工审核,不会直接发布。";

/**
 * 组装 Worker 集:投研/盲区走 Worker 模型,其余触发沿用 demo。
 * 玩家说话不进这里。模型缺位时草稿退回 demo。
 */
export function createModelWorkers(deps: {
  routerModel?: AgentModelPort;
  workerModel?: AgentModelPort;
  persona?: PetPersonaCard;
  /** 脱敏出口(S4):delta 与 Report 共用,缺省不处理。 */
  redact?: TextRedactor;
  /** demo Worker 分步节奏(工单 05):缺省真实等待,测试注入即时假钟。 */
  demoSleep?: (ms: number) => Promise<void>;
  /** demo 对话分拍节奏(工单 12):缺省真实等待,测试注入即时假钟。 */
  demoChatSleep?: (ms: number) => Promise<void>;
  /** 只读工具数据源(工单 16):组合根注入真实实现(投研 JSON/素材库/历史);缺省空实现。 */
  toolSources?: PetToolSources;
  /** 审批落地缝(工单 16):组合根注入真实数据源写入;缺省空实现(状态照常流转)。 */
  approvals?: ApprovalSinks;
}): AgentWorker {
  const demo = new DemoWorker(deps.demoSleep ? { sleep: deps.demoSleep } : undefined);
  const decision = new DecisionWorker({ approvals: deps.approvals });
  const research = new DraftWorker({
    model: deps.workerModel,
    demoText: "投研草稿好了：本周要点三条、风险一条，进待审等你过目。",
    system: RESEARCH_DRAFT_SYSTEM,
    user: (trigger) => `第 ${asText(trigger.data.weekId) || "本期"} 周报到期,请整理本周要点草稿。`,
  });
  const blindspot = new DraftWorker({
    model: deps.workerModel,
    demoText: "盲区草稿好了：新卡的盲区列了两条，进待审等你过目。",
    system: BLINDSPOT_DRAFT_SYSTEM,
    user: (trigger) => {
      const cardIds = asTextArray(trigger.data.cardIds);
      return `素材 ${asText(trigger.data.materialId)} 新发布了 ${cardIds.length} 张策略卡(${cardIds.join("、")}),请做盲区分析草稿。`;
    },
  });
  return {
    // 路由必须原样透传整个 options(onDelta/context 也不例外,B1):
    // 兜底分支少了 context,审批/批注在生产组合下会全部「查不到待办」。
    async run(ticket, trigger, options) {
      // 玩家说话不再进对话 Worker。kind chat 在核心就被拒绝;这里再挡一次,避免旧调用把话当成工单。
      if (trigger.kind === "chat") {
        return { ticketId: ticket.id, status: "dropped", text: "玩家的话走同一段对话，不另开工单。" };
      }
      // 决议命令走审批 Worker(工单 16):同意/驳回闭环到真实数据源,不再只是改状态。
      if (trigger.kind === "command" && isDecisionCommand(asText(trigger.data.text))) {
        return decision.run(ticket, trigger, options);
      }
      if (trigger.kind === "research-due") return research.run(ticket, trigger, options);
      if (trigger.kind === "cards-published") return blindspot.run(ticket, trigger, options);
      return demo.run(ticket, trigger, options);
    },
  };
}
