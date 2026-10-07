import {
  assembleAnalystSystemPrompt,
  assembleManagerMetaPrompt,
  assembleManagerSystemPrompt,
  STYLE_DEMO_MESSAGES,
  TAIL_STYLE_REMINDER,
} from "./prompts";
import { cleanReplyText, sanitizeCustomerText } from "../domain/reply-text";
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

/**
 * p13 实验开关(默认关):尾部语体短提醒 / 开场语体示范轮。小样本冒烟证据
 * 不一致(v1 示范开场稳但偶发问法漏印,v2 示范开场方差放大),按 spec
 * 「确有收益才保留」口径退为显式开启。置 1 启用,如 LLM_TAIL_REMINDER=1。
 */
export const PROMPT_TUNING_ENV = {
  tailReminder: "LLM_TAIL_REMINDER",
  styleDemo: "LLM_STYLE_DEMO",
} as const;

function tuningEnabled(name: string): boolean {
  // 经 globalThis 取 process:本文件同时进浏览器包,src 侧 tsconfig 无 node 类型。
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name] === "1";
}

/**
 * 流式首部缓冲(hold buffer,手册 14.4):称谓前缀/舞台指示若随增量先上屏,
 * 会在终态清洗时「闪现再消失」。开头先暂扣 LEAD_HOLD 个字符,剥净已知
 * 前缀形态后一次性放行,后续增量直通;流提前结束则在收尾补一次放行。
 * 只影响推送给 onReplyDelta 的视图,content 累积仍是原文,终态清洗不变。
 */
const LEAD_HOLD = 20;
const LEAD_ROLE_PREFIX =
  /^\s*(?:理财经理(?:小王)?|小王|经理|话术|AI|客服|assistant|user|system)\s*[:：]\s*/i;
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
export const DEFAULT_MODEL_NAME = "mimo-v2.5";

export class OpenAICompatibleModelAdapter implements CopywritingPort, DialoguePort {
  constructor(private readonly config: ModelAdapterConfig) {}

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
   */
  async generateManagerTurn(
    input: ManagerTurnInput,
    onReplyDelta?: (delta: string) => void,
  ): Promise<ManagerTurnOutput> {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: assembleManagerSystemPrompt(input) },
      // 语体示范轮(p13 实验,默认关):只学口吻,不进历史不落库。
      ...(tuningEnabled(PROMPT_TUNING_ENV.styleDemo) ? STYLE_DEMO_MESSAGES : []),
    ];
    for (const turn of input.history) {
      messages.push({
        role: turn.speaker === "customer" ? "user" : "assistant",
        content: turn.speaker === "customer" ? sanitizeCustomerText(turn.text) : turn.text,
      });
    }
    messages.push({ role: "user", content: sanitizeCustomerText(input.customerText) });
    // 尾部语体短提醒(p13 实验,默认关):越靠近生成点权重越高,只回声既有规则。
    if (tuningEnabled(PROMPT_TUNING_ENV.tailReminder)) {
      messages.push({ role: "system", content: TAIL_STYLE_REMINDER });
    }

    const { content: streamedReply, reasoning } = await this.chatStream(messages, onReplyDelta);
    const reply = cleanReplyText(streamedReply);
    // 思考通道原文沉淀给复盘(p14):超长截断,空则不携带;不进下一轮输入。
    const managerReasoning = reasoning.trim() ? reasoning.trim().slice(0, 8000) : undefined;
    const withReasoning = managerReasoning ? { reasoning: managerReasoning } : {};

    const meta = await this.extractManagerMeta(input, reply).catch((error) => {
      // 降级而非失败:话术已经生成且播给用户,此时抛错会回滚整轮;
      // 丢的只是策略卡高亮与自动收口信号,12 轮硬上限仍然兜底。
      console.warn("[adapter] 元数据提取失败,本轮降级为无元数据:", (error as Error).message);
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
    const { content, reasoning } = await this.chat(
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
   * 流式话术调用:stream=true 读 SSE,reasoning_content 增量只累计不回调
   * (思维链绝不能当话术播出),content 增量逐段交给 onReplyDelta。
   */
  private async chatStream(
    messages: Array<{ role: string; content: string }>,
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
          messages,
          temperature: 0.7,
          max_tokens: 16384,
          // 显式关掉重复惩罚:垫字与口癖要的就是反复出现(p13)。
          frequency_penalty: 0,
          presence_penalty: 0,
          stream: true,
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
          const delta = parsed.choices?.[0].delta;
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
    options?: { temperature?: number },
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
        signal: AbortSignal.timeout(120_000),
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
        throw new Error("语言模型调用超时(120 秒)");
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
      console.warn("[adapter] 语言模型返回缺少内容:", JSON.stringify(data).slice(0, 400));
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
