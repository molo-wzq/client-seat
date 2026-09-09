import { assembleAnalystSystemPrompt, assembleManagerSystemPrompt } from "./prompts";
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

  async generateManagerTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput> {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: assembleManagerSystemPrompt(input) },
    ];
    for (const turn of input.history) {
      messages.push({ role: turn.speaker === "customer" ? "user" : "assistant", content: turn.text });
    }
    messages.push({ role: "user", content: input.customerText });

    // 网关支持 response_format=json_object(票 12 探测:HTTP 200 且输出可解析)。
    // 规则 10 要求只输出 JSON;纯文本降级路径仍保留作最后兜底。
    const { content, reasoning } = await this.chat(messages, {
      response_format: { type: "json_object" },
    });
    if (content.trim()) return this.managerTurnFromText(content);
    // 推理模型偶发把最终 JSON 落在 reasoning_content 而 content 为空:
    // 能解析出结构化输出则采用;思维链文本绝不能当作对话播出。
    if (reasoning.trim()) {
      const raw = parseJsonObject(reasoning) as Partial<ManagerTurnOutput>;
      return this.managerTurnFromRaw(raw);
    }
    throw new Error("语言模型返回为空");
  }

  private managerTurnFromText(content: string): ManagerTurnOutput {
    try {
      const raw = parseJsonObject(content) as Partial<ManagerTurnOutput>;
      return this.managerTurnFromRaw(raw);
    } catch {
      // 容错:模型偶尔输出纯文本。文本本身仍是有效的经理话术,
      // 降级为无策略引用、无元数据的一轮,不让通话中断(策略追溯缺失可见)。
      console.warn("[adapter] 模型未返回 JSON,按纯对话处理:", content.slice(0, 80));
      return { reply: content.trim() };
    }
  }

  private managerTurnFromRaw(raw: Partial<ManagerTurnOutput>): ManagerTurnOutput {
    if (!raw.reply || typeof raw.reply !== "string") {
      throw new Error("模型返回缺少 reply 字段");
    }
    return {
      reply: raw.reply,
      recognizedSignal:
        asOptionalString((raw as Record<string, unknown>).signal) ??
        asOptionalString(raw.recognizedSignal),
      currentGoal:
        asOptionalString((raw as Record<string, unknown>).goal) ??
        asOptionalString(raw.currentGoal),
      usedCardId: asOptionalString(raw.usedCardId),
      shouldEnd: raw.shouldEnd === true,
      endReason: asOptionalString(raw.endReason),
      outcomeSummary: asOptionalString(raw.outcomeSummary),
    };
  }

  private async chat(
    messages: Array<{ role: string; content: string }>,
    extraBody?: Record<string, unknown>,
  ): Promise<{ content: string; reasoning: string }> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      // 推理型模型的思考 token 也计入预算;预算太小会导致输出被截断或为空。
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.7,
        max_tokens: 16384,
        ...extraBody,
      }),
    });
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

/** 说话人区分结果归一:无法辨认说话人的轮次按客户处理,由用户在界面上纠正。 */
function normalizeTurns(raw: unknown): Array<{ speaker: "manager" | "customer"; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((turn) => ({
      speaker: turn.speaker === "manager" ? ("manager" as const) : ("customer" as const),
      text: asString(turn.text, ""),
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
