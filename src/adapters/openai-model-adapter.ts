import {
  assembleAnalystSystemPrompt,
  assembleManagerMetaPrompt,
  assembleManagerSystemPrompt,
  customerLeftClosingSection,
} from "./prompts";
import { errorMessage, maskModelSecrets } from "./model-errors";
import type { ToolCallShape, ToolCompletionShape } from "./failover-model-adapter";

type CompletionMessage = {
  role: string;
  content: string;
  toolCalls?: ToolCallShape[];
  toolCallId?: string;
  name?: string;
};

function toWireMessages(messages: CompletionMessage[]) {
  return messages.map(({ role, content, toolCalls, toolCallId }) => ({
    role,
    content,
    ...(toolCalls ? { tool_calls: toolCalls.map(({ id, name, arguments: args }) => ({
      id, type: "function", function: { name, arguments: args },
    })) } : {}),
    ...(role === "tool" && toolCallId ? { tool_call_id: toolCallId } : {}),
  }));
}
import { cleanReplyText, sanitizeCustomerText } from "../domain/reply-text";
import { DEFAULT_ROLE_CARD, roleDemoMessages, roleTailReminder } from "../domain/role-card";
import { PROMPT_TUNING_ENV, tuningDisabled, tuningEnabled } from "../domain/prompt-tuning";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import type {
  CopywritingPort,
  DialoguePort,
  ManagerTurnInput,
  ManagerTurnOutput,
  TranscriptAnalysis,
} from "../domain/ports";
import type {
  CaseAnalysis,
  StrategyCard,
} from "../domain/types";

// cleanReplyText 已移入领域(流式上屏与落库共用同一清理);此处 re-export 保持既有引用。
export { cleanReplyText };
// 调优开关移入领域层(检索注入在 product-core 侧也要读),此处 re-export 保持既有引用。
export { PROMPT_TUNING_ENV };

/**
 * 流式首部缓冲(hold buffer,手册 14.4):称谓前缀/舞台指示若随增量先上屏,
 * 会在终态清洗时「闪现再消失」。开头先暂扣 LEAD_HOLD 个字符,剥净已知
 * 前缀形态后一次性放行,后续增量直通;流提前结束则在收尾补一次放行。
 * 只影响推送给 onReplyDelta 的视图,content 累积仍是原文,终态清洗不变。
 */
const LEAD_HOLD = 20;
const LEAD_ROLE_PREFIX =
  /^\s*(?:理财经理\S{0,4}|经理|话术|AI|客服|assistant|user|system)\s*[:：]\s*/i;
const LEAD_STAGE_DIRECTION = /^\s*[（(][^（）()\n]{0,20}[）)]\s*/;

function stripStreamLead(text: string): string {
  let rest = text;
  for (;;) {
    const next = rest.replace(LEAD_STAGE_DIRECTION, "").replace(LEAD_ROLE_PREFIX, "");
    if (next === rest) return rest.replace(/^\s+/, "");
    rest = next;
  }
}

/**
 * 真实语言模型适配器:OpenAI 兼容 chat/completions 接口。
 * 默认指向 MIMO(与 L1 转写工具同源),可用环境变量覆盖。
 */
export interface ModelAdapterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_MODEL_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
export const DEFAULT_MODEL_NAME = "mimo-v2.6-pro";

export class OpenAICompatibleModelAdapter implements CopywritingPort, DialoguePort {
  constructor(
    private readonly config: ModelAdapterConfig,
    /** 裁判元数据提取可换模型(注册表 judge 角色,工单 13);缺省复用本适配器(现状行为)。 */
    private readonly judge?: OpenAICompatibleModelAdapter,
  ) {}

  async analyzeTranscript(transcript: string): Promise<TranscriptAnalysis> {
    const { content, reasoning } = await this.chat(
      [
        { role: "system", content: assembleAnalystSystemPrompt() },
        { role: "user", content: `素材标题:${DEFAULT_MATERIAL_TITLE}\n\n转写稿:\n${transcript}` },
      ],
      undefined,
      // 抽取归纳任务:低温压「无中生有」的动作链与舞台(p14)。
      { temperature: 0.2 },
    );
    // 分析输出不直接播出,推理模型的 reasoning_content 同样可用作解析源。
    const source = content.trim() ? content : reasoning;
    const raw = parseJsonObject(source) as {
      analysis?: unknown;
      cards?: unknown;
      turns?: unknown;
    };
    if (!isRecord(raw.analysis) || !Array.isArray(raw.cards)) {
      throw new Error("模型返回的分析缺少 analysis 或 cards 字段");
    }
    return {
      analysis: normalizeAnalysis(raw.analysis),
      cards: raw.cards.filter(isRecord).map(normalizeCard),
      turns: normalizeTurns(raw.turns),
    };
  }

  /**
   * 两段式生成(票 29):
   * 1. 话术调用(流式纯文本)——首字即可上屏,推理模型的思考 token 不占用户等待;
   * 2. 元数据调用(json_object)——裁判提取 signal/goal/usedCardId/shouldEnd 等。
   * 元数据失败只降级(丢高亮/自动收口),不丢整轮对话。
   * closing 为 customer-left 时只做第 1 步:要一句告别,不请裁判决定收口。
   */
  async generateManagerTurn(
    input: ManagerTurnInput,
    onReplyDelta?: (delta: string) => void,
  ): Promise<ManagerTurnOutput> {
    const role = input.role ?? DEFAULT_ROLE_CARD;
    const farewellOnly = input.closing === "customer-left";
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: assembleManagerSystemPrompt(input) },
      // 语体示范轮(p13 实验,默认关):随角色卡携带,只学口吻,不进历史不落库。
      // 离场只要一句告别,不把推销示范轮塞进去。
      ...(!farewellOnly && tuningEnabled(PROMPT_TUNING_ENV.styleDemo) ? roleDemoMessages(role, MAX_MANAGER_TURNS) : []),
    ];
    for (const turn of input.history) {
      messages.push({
        role: turn.speaker === "customer" ? "user" : "assistant",
        content: turn.speaker === "customer" ? sanitizeCustomerText(turn.text) : turn.text,
      });
    }
    messages.push({ role: "user", content: sanitizeCustomerText(input.customerText) });
    // 尾部语体短提醒(p13 实验):越靠近生成点权重越高,只回声本局角色的既有规则。
    // p15 起默认开:靠近生成点的短提醒在 2.6 pro 对照中 9/9(关时 7/9),置 0 可关。
    // 离场换成告别要求,避免尾部提醒把模型又推去提问。
    if (farewellOnly) {
      messages.push({ role: "system", content: customerLeftClosingSection() });
    } else if (!tuningDisabled(PROMPT_TUNING_ENV.tailReminder)) {
      messages.push({ role: "system", content: roleTailReminder(role, MAX_MANAGER_TURNS) });
    }

    const { content: streamedReply, reasoning } = await this.chatStream(messages, onReplyDelta);
    // 称谓前缀按本局角色名剥除:换经理后不再残留上一任的名字规则。
    const reply = cleanReplyText(streamedReply, role.name);
    // 思考通道原文沉淀给复盘(p14):超长截断,空则不携带;不进下一轮输入。
    const managerReasoning = reasoning.trim() ? reasoning.trim().slice(0, 8000) : undefined;
    const withReasoning = managerReasoning ? { reasoning: managerReasoning } : {};

    if (farewellOnly) return { reply, ...withReasoning };

    const meta = await this.extractManagerMeta(input, reply).catch((error) => {
      // 降级而非失败:话术已经生成且播给用户,此时抛错会回滚整轮;
      // 丢的只是策略卡高亮与自动收口信号,12 轮硬上限仍然兜底。
      console.warn("[adapter] 元数据提取失败,本轮降级为无元数据:", maskModelSecrets(errorMessage(error)));
      return null;
    });
    if (!meta) return { reply, ...withReasoning };
    return { reply, ...withReasoning, ...meta };
  }

  /** 第二次调用:裁判提取元数据。任何失败由调用方 catch 后降级。 */
  private async extractManagerMeta(
    input: ManagerTurnInput,
    reply: string,
  ): Promise<Omit<ManagerTurnOutput, "reply">> {
    // 全量历史而非近几轮:拒绝累计计数要数清全部客户轮
    // (通话有 12 经理轮上限,历史长度可控,不会撑爆裁判上下文)。
    const dialogue = [
      ...input.history.map(
        (turn) =>
          `${turn.speaker === "customer" ? "客户" : "经理"}:${
            turn.speaker === "customer" ? sanitizeCustomerText(turn.text) : turn.text
          }`,
      ),
      `客户:${sanitizeCustomerText(input.customerText)}`,
      `经理(刚说):${reply}`,
    ].join("\n");
    const { content, reasoning } = await (this.judge ?? this).chat(
      [
        { role: "system", content: assembleManagerMetaPrompt(input) },
        { role: "user", content: `对话记录:\n${dialogue}\n\n请输出元数据 JSON。` },
      ],
      { response_format: { type: "json_object" } },
      // 裁判是分类任务不是创作:低温换判定稳定(p13 参数分层)。
      { temperature: 0.1 },
    );
    const source = content.trim() ? content : reasoning;
    const raw = parseJsonObject(source) as Partial<ManagerTurnOutput> & { signal?: unknown; goal?: unknown };
    if (!isRecord(raw)) throw new Error("元数据输出不是 JSON 对象");
    return {
      recognizedSignal:
        asOptionalString((raw as Record<string, unknown>).signal) ??
        asOptionalString(raw.recognizedSignal),
      currentGoal:
        asOptionalString((raw as Record<string, unknown>).goal) ??
        asOptionalString(raw.currentGoal),
      usedCardId: asOptionalString(raw.usedCardId),
      // 匹配依据只在有卡时才有意义;无卡时丢弃,不产出悬空依据。
      cardMatchBasis: asOptionalString(raw.usedCardId)
        ? asOptionalString(raw.cardMatchBasis)
        : undefined,
      shouldEnd: raw.shouldEnd === true,
      endReason: asOptionalString(raw.endReason),
      outcomeSummary: asOptionalString(raw.outcomeSummary),
      logicHint: asOptionalString(raw.logicHint),
      ...(Array.isArray(raw.factCheckNotes) ? { factCheckNotes: raw.factCheckNotes.filter((note): note is string => typeof note === "string" && Boolean(note.trim())).slice(0, 3).map((note) => note.trim().slice(0, 500)) } : {}),
    };
  }

  /**
   * 通用流式补全(工单 11:桌宠 Agent 的模型端口):复用同一条 OpenAI 兼容
   * SSE 链路,但不带经理话术的首部清洗、称谓剥除与元数据裁判——调用方
   * (server/agent/workers.ts)自行处理表情前缀等协议。
   */
  async completeStream(
    messages: CompletionMessage[],
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    const { content } = await this.chatStream(messages, onDelta);
    return content;
  }

  /**
   * 带工具的非流式补全(工单 16:桌宠只读工具):assistant 的 toolCalls 映射成
   * 线格式 tool_calls,tool 消息带 tool_call_id;返回扁平的调用形状给调用方。
   * 非流式——工具调用没有"半截增量"顾虑,失败可由链上层直接切备用。
   */
  async completeWithTools(
    messages: CompletionMessage[],
    tools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
  ): Promise<ToolCompletionShape> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: this.config.model,
          messages: toWireMessages(messages),
          temperature: 0.7,
          max_tokens: 16384,
          frequency_penalty: 0,
          presence_penalty: 0,
          tools,
        }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("语言模型调用超时(120 秒)");
      }
      throw error;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`语言模型调用失败(HTTP ${response.status}):${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const choice = data.choices?.[0];
    const calls = (choice?.message?.tool_calls ?? [])
      .filter((call) => typeof call.id === "string" && typeof call.function?.name === "string")
      .map((call) => ({
        id: call.id as string,
        name: call.function!.name!,
        arguments: typeof call.function?.arguments === "string" ? call.function.arguments : "{}",
      }));
    if (calls.length > 0) return { type: "tool_calls", calls };
    const content = choice?.message?.content ?? "";
    if (!content.trim()) {
      console.warn("[adapter] 带工具补全返回为空:", maskModelSecrets(JSON.stringify(data).slice(0, 400)));
      throw new Error("语言模型返回为空");
    }
    return { type: "text", text: content };
  }

  /**
   * 流式话术调用:stream=true 读 SSE,reasoning_content 增量只累计不回调
   * (思维链绝不能当话术播出),content 增量逐段交给 onReplyDelta。
   */
  private async chatStream(
    messages: CompletionMessage[],
    onReplyDelta?: (delta: string) => void,
  ): Promise<{ content: string; reasoning: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: this.config.model,
          messages: toWireMessages(messages),
          temperature: 0.7,
          max_tokens: 16384,
          // 显式关掉重复惩罚:垫字与口癖要的就是反复出现(p13)。
          frequency_penalty: 0,
          presence_penalty: 0,
          stream: true,
          ...(tuningEnabled(PROMPT_TUNING_ENV.managerNoThinking)
            ? { thinking: { type: "disabled" } }
            : {}),
        }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("语言模型调用超时(120 秒)");
      }
      throw error;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`语言模型调用失败(HTTP ${response.status}):${body.slice(0, 300)}`);
    }
    if (!response.body) throw new Error("语言模型网关未返回流式响应体");

    let content = "";
    let reasoning = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // 首部缓冲状态:未放行前先攒进 lead,攒够 LEAD_HOLD 或流结束时剥净放行。
    let lead = "";
    let leadFlushed = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔;残包留回 buffer 等下一个 chunk。
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let parsed: {
            choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
          };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue; // 半截 JSON(理论上不会出现,残包已在 buffer 层拦截)
          }
          // 末尾 usage 块等会带空 choices 数组(mimo-v2.6 实测):[0] 为 undefined,须继续可选链。
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) reasoning += delta.reasoning_content;
          if (delta.content) {
            content += delta.content;
            if (!onReplyDelta) continue;
            if (leadFlushed) {
              onReplyDelta(delta.content);
              continue;
            }
            lead += delta.content;
            if (lead.length >= LEAD_HOLD) {
              leadFlushed = true;
              const rest = stripStreamLead(lead);
              lead = "";
              if (rest) onReplyDelta(rest);
            }
          }
        }
      }
    }
    // 流在攒够 LEAD_HOLD 前结束:剥净首部后补一次放行,短回复不丢增量。
    if (!leadFlushed && lead) {
      const rest = stripStreamLead(lead);
      if (rest) onReplyDelta?.(rest);
    }
    if (!content.trim() && !reasoning.trim()) {
      console.warn("[adapter] 语言模型流式返回缺少内容");
      throw new Error("语言模型返回为空");
    }
    // 纯文本模式下思维链不是可播出的话术:content 为空同样按空处理。
    if (!content.trim()) {
      console.warn("[adapter] 话术内容为空(仅思维链),拒绝播出");
      throw new Error("语言模型返回为空");
    }
    return { content, reasoning };
  }

  private async chat(
    messages: Array<{ role: string; content: string }>,
    extraBody?: Record<string, unknown>,
    options?: { temperature?: number; signal?: AbortSignal },
  ): Promise<{ content: string; reasoning: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        // 网关挂起时无超时会让通话轮次永久悬挂;推理长尾预留充足预算。
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(120_000),
        // 推理型模型的思考 token 也计入预算;预算太小会导致输出被截断或为空。
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: 16384,
          frequency_penalty: 0,
          presence_penalty: 0,
          ...extraBody,
        }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        if (options?.signal?.aborted) throw error;
        throw new Error(`语言模型调用超时(${options?.signal ? 30 : 120} 秒)`);
      }
      throw error;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`语言模型调用失败(HTTP ${response.status}):${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    const reasoning = choice?.message?.reasoning_content ?? "";
    if (!content.trim() && !reasoning.trim()) {
      console.warn("[adapter] 语言模型返回缺少内容:", maskModelSecrets(JSON.stringify(data).slice(0, 400)));
      throw new Error("语言模型返回为空");
    }
    if (choice?.finish_reason === "length") {
      console.warn("[adapter] 语言模型输出因长度限制被截断,JSON 可能不完整");
    }
    return { content, reasoning };
  }
}

const DEFAULT_MATERIAL_TITLE = "未命名素材";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback = "未知"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item, "")).filter((item) => item.length > 0);
}

/** 模型输出不可信任:缺字段、类型漂移都要归一到领域结构,未知保持未知。 */
export function normalizeAnalysis(raw: Record<string, unknown>): CaseAnalysis {
  const stages = Array.isArray(raw.stages) ? raw.stages.filter(isRecord) : [];
  return {
    scenario: asString(raw.scenario),
    customerState: asString(raw.customerState),
    overallGoal: asString(raw.overallGoal),
    stages: stages.map((stage) => ({
      name: asString(stage.name),
      turnRange: asString(stage.turnRange, "未知"),
      purpose: asString(stage.purpose),
      customerSignals: asString(stage.customerSignals),
      advanceLogic: asString(stage.advanceLogic),
      keyActions: asStringArray(stage.keyActions),
      representativeQuotes: asStringArray(stage.representativeQuotes),
    })),
    strengths: asStringArray(raw.strengths),
    weaknesses: asStringArray(raw.weaknesses),
    actualResult: asString(raw.actualResult),
    reusableConditions: asStringArray(raw.reusableConditions),
  };
}

export function normalizeCard(
  raw: Record<string, unknown>,
  index?: number,
): Omit<StrategyCard, "status"> {
  const source = isRecord(raw.sourceExcerpt) ? raw.sourceExcerpt : {};
  return {
    id: asString(raw.id, `sc-${(index ?? 0) + 1}`),
    name: asString(raw.name, "未命名策略卡"),
    sourceExcerpt: {
      materialTitle: asString(source.materialTitle, DEFAULT_MATERIAL_TITLE),
      turnRange: asString(source.turnRange, "未知"),
    },
    triggerSignals: asStringArray(raw.triggerSignals),
    triggerKeywords: asStringArray(raw.triggerKeywords),
    applicableScenario: asString(raw.applicableScenario),
    currentPurpose: asString(raw.currentPurpose),
    actionChain: asStringArray(raw.actionChain),
    expressionPrinciples: asStringArray(raw.expressionPrinciples),
    referenceScripts: asStringArray(raw.referenceScripts),
    applicableConditions: asStringArray(raw.applicableConditions),
    stopConditions: asStringArray(raw.stopConditions),
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 说话人区分结果归一:无法辨认说话人的轮次按客户处理,由用户在界面上纠正。
 * 转写标注的轮次号(如 T07)原样保留,保证策略卡 turnRange 与轮次可对回。
 */
function normalizeTurns(raw: unknown): Array<{ speaker: "manager" | "customer"; text: string; number?: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((turn) => ({
      speaker: turn.speaker === "manager" ? ("manager" as const) : ("customer" as const),
      text: asString(turn.text, ""),
      number:
        typeof turn.number === "number" && Number.isInteger(turn.number) && turn.number > 0
          ? turn.number
          : undefined,
    }))
    .filter((turn) => turn.text.length > 0);
}

/** 容忍代码块围栏等包装,提取首个 JSON 对象。 */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`模型输出无法解析为 JSON:${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(`模型输出 JSON 解析失败:${(error as Error).message}`);
  }
}
