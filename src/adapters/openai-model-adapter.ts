import {
  assembleAnalystSystemPrompt,
  assembleManagerMetaPrompt,
  assembleManagerSystemPrompt,
} from "./prompts";
import { cleanReplyText } from "../domain/reply-text";
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
    const { content, reasoning } = await this.chat([
      { role: "system", content: assembleAnalystSystemPrompt() },
      { role: "user", content: `素材标题:${DEFAULT_MATERIAL_TITLE}\n\n转写稿:\n${transcript}` },
    ]);
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
    ];
    for (const turn of input.history) {
      messages.push({ role: turn.speaker === "customer" ? "user" : "assistant", content: turn.text });
    }
    messages.push({ role: "user", content: input.customerText });

    const { content: streamedReply } = await this.chatStream(messages, onReplyDelta);
    const reply = cleanReplyText(streamedReply);

    const meta = await this.extractManagerMeta(input, reply).catch((error) => {
      // 降级而非失败:话术已经生成且播给用户,此时抛错会回滚整轮;
      // 丢的只是策略卡高亮与自动收口信号,12 轮硬上限仍然兜底。
      console.warn("[adapter] 元数据提取失败,本轮降级为无元数据:", (error as Error).message);
      return null;
    });
    if (!meta) return { reply };
    return { reply, ...meta };
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
        (turn) => `${turn.speaker === "customer" ? "客户" : "经理"}:${turn.text}`,
      ),
      `客户:${input.customerText}`,
      `经理(刚说):${reply}`,
    ].join("\n");
    const { content, reasoning } = await this.chat(
      [
        { role: "system", content: assembleManagerMetaPrompt(input) },
        { role: "user", content: `对话记录:\n${dialogue}\n\n请输出元数据 JSON。` },
      ],
      { response_format: { type: "json_object" } },
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
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) reasoning += delta.reasoning_content;
          if (delta.content) {
            content += delta.content;
            onReplyDelta?.(delta.content);
          }
        }
      }
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
          temperature: 0.7,
          max_tokens: 16384,
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
