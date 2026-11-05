import type { AgentWorker, WorkerRunOptions } from "./core";
import { DemoWorker } from "./workers/demo";
import type { AgentReport, AgentTicket, AgentTrigger, PetEmotion } from "./types";
import { classifyModelError, errorMessage, maskModelSecrets } from "../../src/adapters/model-errors";
import { DEFAULT_PET_PERSONA, PET_EMOTIONS, assemblePetSystemPrompt, type PetPersonaCard } from "./pet-persona";
import { CHAT_CONTEXT_LIMITS, type ChatContext } from "../../src/shared/agent-contract";
// PET_EMOTIONS 仅用于拼 EMOTION_TAG 正则与上限,标签语义见 pet-persona.ts。

/**
 * 真实模型 Worker(工单 11):有 key 走模型,没 key 或出错退回 demo,演示不断。
 * - 对话 Worker(chat):桌宠以人格卡口吻回玩家,流式 delta、表情剥离、快捷动作建议;
 * - 投研/盲区 Worker(research-due / cards-published):只产 waiting 草稿,人审闸门不变
 *   (ADR 0007)——Worker 手上没有任何发布接口,草稿永远到不了牌桌。
 * 脱敏(S4):服务端不接受前端传入的 hidden 原文;输出文本(delta 与 Report)
 * 共用同一个可注入 redact 出口,默认不做处理。
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

const emptySources: PetToolSources = {
  weeklyResearch: async () => "本周投研数据源未接入,查不到。",
  searchCards: async () => "策略卡数据源未接入,查不到。",
  lastReview: async () => "还没有上一局复盘。",
};

/** 四个只读工具(工单 16):全部本地数据,不接外网、不查实时利率。 */
export const PET_TOOL_SPECS: readonly AgentToolSpec[] = [
  {
    type: "function",
    function: {
      name: "get_weekly_research",
      description: "查本周投研情报卡(宏观要点、行业主线、风险提示),不查实时利率。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_cards",
      description: "按关键词查策略卡,返回卡面要点与原始通话片段出处。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "关键词,如「存款搬家」" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_last_review",
      description: "查上一局对战的复盘摘要。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_card",
      description: "查当前客户的公开面(姓名与经理也看得到的可见信息)。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
] as const;

/** 工具名 → 给人看的短名(progress 文案与轨迹用)。 */
const PET_TOOL_LABELS: Record<string, string> = {
  get_weekly_research: "本周投研",
  search_cards: "策略卡",
  get_last_review: "上局复盘",
  get_customer_card: "客户公开面",
};

/** 工具调用轮数上限(工单 16):超出后不再提供工具,强制收口。 */
const PET_TOOL_MAX_ROUNDS = 3;

/** 工具的 progress 文案:工具名 + 一句中文(工单 15 的「做了什么」轨迹吃它)。 */
function petToolProgressText(name: string): string {
  return `查了${PET_TOOL_LABELS[name] ?? name},拿回来就能说。`;
}

/** 防御性解析工具参数:坏 JSON 当空对象。 */
function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 执行一次只读工具:数据从注入的数据源或牌局快照取,绝不外联。 */
async function runPetTool(call: AgentToolCall, sources: PetToolSources, context: ChatContext | undefined): Promise<string> {
  const args = parseToolArguments(call.arguments);
  switch (call.name) {
    case "get_weekly_research":
      return sources.weeklyResearch();
    case "search_cards":
      return sources.searchCards(asText(args.keyword));
    case "get_last_review":
      return sources.lastReview();
    case "get_customer_card":
      if (context?.phase !== "game") return "当前不在牌局,没有客户卡。";
      return `${context.customer.name};公开面:${context.customer.visible.join(";")}`;
    default:
      return `未知工具:${call.name}`;
  }
}

/** 对话面板单条上限(工单 11):气泡 40 字由核心截,这里截的是对话全文。 */
export const CHAT_MAX_CHARS = 120;
/** 草稿长度上限:待办卡片可展开读,超长截断防失控。 */
const DRAFT_MAX_CHARS = 500;
/** 进模型的对话历史轮数上限(spec:history 最近 N 轮)。 */
const CHAT_HISTORY_TURNS = 8;

/** 演示节奏(工单 12):demo 对话每拍间隔与字数,面板看得见逐字又不拖沓。 */
const DEMO_CHAT_STEP_MS = 160;
const DEMO_CHAT_CHUNK_CHARS = 4;

/** 缺省 sleep:真实等待;测试注入即时假钟。 */
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * demo 对话脚本(工单 12,无 key):按玩家话挑一句带表情前缀的桌宠口吻回复。
 * 建议动作(工单 16)不再从玩家话里猜命令意图,改为按牌局回合给固定 2 个
 * (demoSuggestions),与真实模型同形状,demo 模式完整可演示。
 */
function demoChatReply(text: string): string {
  if (/复盘|上一局/.test(text)) return "[think]这局我陪着看的，值得学的一招我先记下。";
  if (/在吗|你好|嗨|打招呼|陪|说说话/.test(text)) return "[wave]我在呢，你说，我听着。";
  return "[wave]收到，先搁我手上，好了叫你。";
}

/** 表情前缀:模型按提示词约定开头,如「[cheer]正文」;标签表与提示词同源(pet-persona)。
 * 容忍前导空白(S3):模型常以换行开头,trim 后的最终 Report 剥得掉,流式也要剥得掉。 */
const EMOTION_TAG = new RegExp(`^\\s*\\[(${PET_EMOTIONS.join("|")})\\]\\s*`);
/** 可能构成表情前缀的最大长度:按标签表算出(「[sleepy]」)。 */
const EMOTION_TAG_MAX_CHARS = Math.max(...PET_EMOTIONS.map((emotion) => `[${emotion}]`.length));

/** 建议尾行标记(工单 16):模型把本轮建议动作写在末尾这一行,Worker 剥成 quickActions。 */
const SUGGESTION_MARKER = "【建议】";
/** 建议条数上限(工单 16):每轮最多 3 个建议动作。 */
const SUGGESTION_MAX_ITEMS = 3;

/** 把回复拆成正文与建议动作:尾行「【建议】a | b | c」剥掉,条数截到上限。 */
function splitSuggestionTail(reply: string): { text: string; suggestions: string[] } {
  const index = reply.indexOf(SUGGESTION_MARKER);
  if (index < 0) return { text: reply, suggestions: [] };
  const suggestions = reply
    .slice(index + SUGGESTION_MARKER.length)
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .slice(0, SUGGESTION_MAX_ITEMS);
  return { text: reply.slice(0, index).trimEnd(), suggestions };
}

/**
 * 建议尾行流式闸门(工单 16):标记(含跨增量拆开的部分标记)之前照常放出,
 * 标记起整段扣住——建议只进 quickActions 按钮,绝不当正文上屏。
 * flush 在流结束时补放扣住的残字(没凑成标记的部分)。
 */
function createSuggestionGate(emit: (piece: string) => void): { push: (piece: string) => void; flush: () => void } {
  let buffer = "";
  let closed = false;
  return {
    push(piece) {
      if (closed || piece === "") return;
      buffer += piece;
      const index = buffer.indexOf(SUGGESTION_MARKER);
      if (index >= 0) {
        closed = true;
        // 标记前的换行是协议分隔符,不算正文;与最终 Report 的 trimEnd 口径一致。
        emit(buffer.slice(0, index).trimEnd());
        buffer = "";
        return;
      }
      // 尾部若是标记的前缀,先扣住等下一段;最长匹配,不误伤正文里的「【」。
      const chars = [...buffer];
      let hold = 0;
      for (let len = Math.min(chars.length, SUGGESTION_MARKER.length - 1); len > 0; len -= 1) {
        if (SUGGESTION_MARKER.startsWith(chars.slice(-len).join(""))) {
          hold = len;
          break;
        }
      }
      // 紧邻其后的尾部空白同理(可能是建议行前的分隔换行):一并扣住,
      // 正文还有下文时随下一段补放;流结束由 flush 兜底放出。
      while (hold < chars.length && /\s/.test(chars[chars.length - hold - 1] ?? "")) hold += 1;
      const safe = chars.slice(0, chars.length - hold);
      if (safe.length > 0) emit(safe.join(""));
      buffer = chars.slice(chars.length - hold).join("");
    },
    flush() {
      if (closed || buffer === "") return;
      const rest = buffer;
      buffer = "";
      emit(rest);
    },
  };
}

/** demo 按回合给的建议(工单 16):固定 2 个,牌局阶段不同换一套;不在牌局给开场那 2 个。 */
function demoSuggestions(context: ChatContext | undefined): string[] {
  if (context?.phase !== "game") return ["这周投研帮我划重点", "陪我看看上局哪里值得学"];
  if (context.turnNumber <= 4) return ["他在探我底？", "帮我想个推托的说法"];
  if (context.turnNumber <= 8) return ["这招想引我说什么？", "帮我顶住不松口"];
  return ["他想收口了？", "帮我留个台阶别把话说死"];
}

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

/** 缺省脱敏:不处理。 */
const noRedact: TextRedactor = (text) => text;

/** 从完整回复里剥表情前缀,返回正文与表情;没有前缀时表情为 undefined。 */
function stripEmotionTag(reply: string): { text: string; emotion: PetEmotion | undefined } {
  const match = EMOTION_TAG.exec(reply);
  if (!match) return { text: reply, emotion: undefined };
  return { text: reply.slice(match[0].length), emotion: match[1] as PetEmotion };
}

/** 对话历史轮(data.history):只认 {speaker,text},player→user、pet→assistant。 */
function parseHistory(value: unknown): AgentModelMessage[] {
  const turns = Array.isArray(value) ? value.filter((turn) => typeof turn === "object" && turn !== null) : [];
  return turns
    .map((turn) => ({
      role: (turn as { speaker?: unknown }).speaker === "pet" ? ("assistant" as const) : ("user" as const),
      content: asText((turn as { text?: unknown }).text),
    }))
    .filter((message) => message.content !== "")
    .slice(-CHAT_HISTORY_TURNS);
}

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
  ].join("\n");
}

/** 从触发 data 里防御性取快照:形状不是 ChatContext 两态之一就当没有。 */
function parseChatContext(value: unknown): ChatContext | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const context = value as ChatContext;
  if (context.phase === "idle" && typeof context.act === "string") return context;
  if (context.phase === "game" && typeof context.customer?.name === "string") return context;
  return undefined;
}

/** 对话 Worker:走 Router(轻量)模型;出错/无 key 退回 demo 脚本,桌宠不卡死。 */
class ChatWorker implements AgentWorker {
  constructor(
    private readonly deps: {
      model?: AgentModelPort;
      persona: PetPersonaCard;
      /** 脱敏出口(S4):delta 逐段与 Report 全文共用。 */
      redact: TextRedactor;
      /** demo 分拍节奏(工单 12):测试注入即时假钟。 */
      sleep: (ms: number) => Promise<void>;
      /** 只读工具数据源(工单 16):组合根注入,缺省空实现。 */
      toolSources: PetToolSources;
    },
  ) {}

  async run(ticket: AgentTicket, trigger: AgentTrigger, options: WorkerRunOptions): Promise<AgentReport> {
    const { onReport, onDelta } = options;
    const text = asText(trigger.data.text);
    const view = asText(trigger.data.view);
    // 牌局快照(工单 16):拼在人格提示词后,只进桌宠这一侧;落账前已剔除(core)。
    const context = parseChatContext(trigger.data.context);
    const toolsAvailable = typeof this.deps.model?.completeWithTools === "function";
    const systemPrompt =
      assemblePetSystemPrompt(this.deps.persona, view || undefined) +
      (context ? `\n${renderChatContext(context)}` : "") +
      (toolsAvailable ? `\n${PET_TOOLS_PROMPT}` : "");
    // 无 key:走演示脚本回复,一样分拍流式、带表情,并模拟一次工具调用(工单 16)。
    if (!this.deps.model) return this.runDemoChat(ticket, text, onReport, onDelta, context);
    const messages: AgentModelMessage[] = [
      { role: "system", content: systemPrompt },
      ...parseHistory(trigger.data.history),
      { role: "user", content: text },
    ];
    // 增量出口状态:先声明再进 try——await 挂起期间模型回调就要读它们。
    // 表情前缀没判定清楚前先扣住,判定后正文直通;总量不超过单条上限。
    let pendingLead = "";
    let leadResolved = false;
    let emittedChars = 0;
    // 是否已有正文推给玩家(S2):已流出的失败不能再退回 demo 流,面板会看到两段拼接的怪话。
    let streamed = false;
    const emit = (piece: string): void => {
      if (!onDelta || piece === "" || emittedChars >= CHAT_MAX_CHARS) return;
      const room = CHAT_MAX_CHARS - emittedChars;
      const out = [...piece].slice(0, room).join("");
      emittedChars += [...out].length;
      if (out.length > 0) streamed = true;
      // delta 与 Report 共用同一个脱敏出口(S4)。
      onDelta(this.deps.redact(out));
    };
    // 建议尾行闸门(工单 16):【建议】起整段扣住,只进 quickActions 按钮不上屏。
    const suggestionGate = createSuggestionGate(emit);
    const forwardStripped = (delta: string): void => {
      if (!onDelta) return;
      if (leadResolved) return suggestionGate.push(delta);
      pendingLead += delta;
      const match = EMOTION_TAG.exec(pendingLead);
      if (match) {
        leadResolved = true;
        suggestionGate.push(pendingLead.slice(match[0].length));
        pendingLead = "";
        return;
      }
      // 只有前导空白、或空白后以 [ 开头:仍可能构成表情前缀,继续扣住(S3);
      // 长度上限按去掉空白的部分算,空白不占标签预算。
      const rest = pendingLead.trimStart();
      if (rest === "" || rest.startsWith("[")) {
        if (rest !== "" && [...rest].length > EMOTION_TAG_MAX_CHARS) {
          leadResolved = true;
          suggestionGate.push(pendingLead);
          pendingLead = "";
        }
        return;
      }
      leadResolved = true;
      suggestionGate.push(pendingLead);
      pendingLead = "";
    };
    /** 流结束(S3):前缀一直没判定成(如「[好]」),扣住的字符按正文补放,不丢字。 */
    const flushPendingLead = (): void => {
      if (leadResolved || pendingLead === "") return;
      leadResolved = true;
      const rest = EMOTION_TAG.exec(pendingLead) ? pendingLead.replace(EMOTION_TAG, "") : pendingLead;
      pendingLead = "";
      suggestionGate.push(rest);
    };
    try {
      const raw = await this.runToReply(ticket.id, messages, onReport, forwardStripped, context);
      flushPendingLead();
      suggestionGate.flush();
      // 建议尾行(工单 16):剥成 quickActions(动态建议,替换工单 15 的建议位)。
      const { text: body, suggestions } = splitSuggestionTail(raw.trim());
      const { text: cleanedBody, emotion } = stripEmotionTag(body);
      const cleaned = truncateChars(this.deps.redact(cleanedBody), CHAT_MAX_CHARS);
      return {
        ticketId: ticket.id,
        status: "ready",
        text: cleaned,
        ...(emotion ? { emotion } : {}),
        ...(suggestions.length > 0 ? { quickActions: suggestions } : {}),
      };
    } catch (error) {
      // 原始报错不进 Report/账本/气泡(S5):对外只写中文短码,
      // 原文(掩掉形如密钥的串)只进服务端日志。
      const code = classifyModelError(error);
      console.warn(`[agent] 对话模型失败(${code}):${maskModelSecrets(errorMessage(error))}`);
      // 半截正文已经上屏(S2):不再退回 demo 流,直接以 failed 收口——
      // 否则面板会把演示话术接在半截真实输出后面,拼成两段不相干的话。
      if (streamed) {
        return { ticketId: ticket.id, status: "failed", text: `真实模型没接上：${code}。刚才那句只说了一半，再说一遍？` };
      }
      // 一个字都没流出:落 failed 写明原因,退回 demo 脚本(工单 11:桌宠不卡死)。
      await onReport({
        ticketId: ticket.id,
        status: "failed",
        text: `真实模型没接上：${code}。先用演示话回你。`,
      });
      return this.runDemoChat(ticket, text, onReport, onDelta, context);
    }
  }

  /**
   * 拿到最终回复(工单 16):模型支持工具时先走 function calling 循环
   * (最多 3 轮,每轮工具调用发一条 progress,结果作为 tool 消息回模型);
   * 文本结果一次性放出(表情前缀闸门照走);轮次用尽或模型不支持工具时
   * 退回流式补全——收口一律不带工具,模型只能直接作答。
   */
  private async runToReply(
    ticketId: string,
    messages: AgentModelMessage[],
    onReport: (report: AgentReport) => Promise<void>,
    emitText: (piece: string) => void,
    context: ChatContext | undefined,
  ): Promise<string> {
    const model = this.deps.model!;
    if (!model.completeWithTools) return model.completeStream(messages, emitText);
    for (let round = 0; round < PET_TOOL_MAX_ROUNDS; round += 1) {
      const result = await model.completeWithTools(messages, [...PET_TOOL_SPECS]);
      if (result.type === "text") {
        emitText(result.text);
        return result.text;
      }
      messages.push({ role: "assistant", content: "", toolCalls: result.calls });
      for (const call of result.calls) {
        await onReport({ ticketId, status: "progress", text: petToolProgressText(call.name) });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: await runPetTool(call, this.deps.toolSources, context),
        });
      }
    }
    // 轮次用尽:不再提供工具,流式收口(真实等待,不是伪进度)。
    return model.completeStream(messages, emitText);
  }

  /** 演示对话(无 key/回退):先模拟一次工具调用(progress),脚本回复再分拍流出。 */
  private async runDemoChat(
    ticket: AgentTicket,
    text: string,
    onReport: (report: AgentReport) => Promise<void>,
    onDelta?: (delta: string) => void,
    context?: ChatContext,
  ): Promise<AgentReport> {
    // demo 用脚本模拟一次工具调用(工单 16):轨迹里看得见「查了什么」,
    // 牌局里查客户公开面(读快照),不在牌局查本周投研。
    const toolLabel = context?.phase === "game" ? PET_TOOL_LABELS.get_customer_card : PET_TOOL_LABELS.get_weekly_research;
    await onReport({ ticketId: ticket.id, status: "progress", text: `查了${toolLabel},翻到相关那页。` });
    await this.deps.sleep(DEMO_CHAT_STEP_MS);
    const { text: body, emotion } = stripEmotionTag(demoChatReply(text));
    const chars = [...truncateChars(this.deps.redact(body), CHAT_MAX_CHARS)];
    for (let start = 0; start < chars.length; start += DEMO_CHAT_CHUNK_CHARS) {
      if (start > 0) await this.deps.sleep(DEMO_CHAT_STEP_MS);
      onDelta?.(this.deps.redact(chars.slice(start, start + DEMO_CHAT_CHUNK_CHARS).join("")));
    }
    // demo 建议按牌局回合给固定 2 个(工单 16),与真实模型同形状。
    const quickActions = demoSuggestions(context);
    return {
      ticketId: ticket.id,
      status: "ready",
      text: chars.join(""),
      ...(emotion ? { emotion } : {}),
      ...(quickActions.length > 0 ? { quickActions } : {}),
    };
  }
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

/** 工具段系统提示(工单 16):只描述可用工具与「不编造」约束,不带数据本身。 */
const PET_TOOLS_PROMPT = [
  "## 手上的查询工具",
  "get_weekly_research(本周投研情报卡)、search_cards(按关键词查策略卡与出处)、get_last_review(上一局复盘摘要)、get_customer_card(当前客户公开面)。",
  "涉及这些内容先查工具再回答;工具查不到就直说没有,不接外网、不编造实时数据。",
].join("\n");

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

const noApprovals: ApprovalSinks = {
  fileResearch: () => undefined,
  queueBlindspot: () => undefined,
};

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
  constructor(private readonly deps: { approvals: ApprovalSinks }) {}

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
    if (target.worker === "投研") {
      await this.deps.approvals.fileResearch(target.text);
      await onReport({ ticketId: target.ticketId, status: "ready", text: "已放进本周档案夹（桌宠起草·已审）。" });
      return { ticketId: ticket.id, status: "ready", text: "已放进本周档案夹，随时能查。" };
    }
    if (target.worker === "盲区") {
      await this.deps.approvals.queueBlindspot(target.text);
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
 * 组装工单 11 的 Worker 集:chat 走 Router(轻量)模型,投研/盲区走 Worker(强)模型;
 * 其余触发类型沿用 demo Worker。模型缺位(无 key)时各自退回 demo,演示模式完整可演示。
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
  const persona = deps.persona ?? DEFAULT_PET_PERSONA;
  const decision = new DecisionWorker({ approvals: deps.approvals ?? noApprovals });
  const chat = new ChatWorker({
    model: deps.routerModel,
    persona,
    redact: deps.redact ?? noRedact,
    sleep: deps.demoChatSleep ?? defaultSleep,
    toolSources: deps.toolSources ?? emptySources,
  });
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
      if (trigger.kind === "chat") return chat.run(ticket, trigger, options);
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
