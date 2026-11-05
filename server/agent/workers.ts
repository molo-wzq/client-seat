import type { AgentWorker, WorkerRunOptions } from "./core";
import { DemoWorker } from "./workers/demo";
import type { AgentReport, AgentTicket, AgentTrigger, PetEmotion } from "./types";
import { DEFAULT_PET_PERSONA, PET_EMOTIONS, assemblePetSystemPrompt, type PetPersonaCard } from "./pet-persona";
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
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AgentModelPort {
  /** 流式补全:onDelta 逐段回调增量,resolve 完整正文(含可能的表情前缀)。 */
  completeStream(messages: AgentModelMessage[], onDelta?: (delta: string) => void): Promise<string>;
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
 * demo 对话脚本(工单 12,无 key):按玩家话挑一句带表情前缀的桌宠口吻回复;
 * 意图命中时快捷动作建议照给——与真实模型同形状,demo 模式完整可演示。
 */
function demoChatReply(text: string): string {
  if (detectQuickActions(text).length > 0) return "[cheer]好，这就去安排。";
  if (/复盘|上一局/.test(text)) return "[think]这局我陪着看的，值得学的一招我先记下。";
  if (/在吗|你好|嗨|打招呼|陪|说说话/.test(text)) return "[wave]我在呢，你说，我听着。";
  return "[wave]收到，先搁我手上，好了叫你。";
}

/** 表情前缀:模型按提示词约定开头,如「[cheer]正文」;标签表与提示词同源(pet-persona)。
 * 容忍前导空白(S3):模型常以换行开头,trim 后的最终 Report 剥得掉,流式也要剥得掉。 */
const EMOTION_TAG = new RegExp(`^\\s*\\[(${PET_EMOTIONS.join("|")})\\]\\s*`);
/** 可能构成表情前缀的最大长度:按标签表算出(「[sleepy]」)。 */
const EMOTION_TAG_MAX_CHARS = Math.max(...PET_EMOTIONS.map((emotion) => `[${emotion}]`.length));

/** 快捷动作意图表:玩家话里的命令意图 → 快捷环按钮文案(DeskPet QUICK_RING 同名)。 */
const QUICK_ACTION_INTENTS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /换个?客户|换一位/, label: "换个客户" },
  { pattern: /再来一局|再开一局|重新开一局/, label: "再来一局" },
  { pattern: /上局复盘|上一局复盘|复盘上一局/, label: "上局复盘" },
  { pattern: /本周投研|投研/, label: "本周投研" },
];

/** 从玩家话里识别命令意图:只给建议(按钮文案),不执行。 */
function detectQuickActions(text: string): string[] {
  return QUICK_ACTION_INTENTS.filter((intent) => intent.pattern.test(text)).map((intent) => intent.label);
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
    },
  ) {}

  async run(ticket: AgentTicket, trigger: AgentTrigger, options: WorkerRunOptions): Promise<AgentReport> {
    const { onReport, onDelta } = options;
    const text = asText(trigger.data.text);
    const view = asText(trigger.data.view);
    // 无 key:走演示脚本回复,一样分拍流式、带表情与快捷动作(工单 12:demo 完整可演示)。
    if (!this.deps.model) return this.runDemoChat(ticket, text, onDelta);
    const messages: AgentModelMessage[] = [
      { role: "system", content: assemblePetSystemPrompt(this.deps.persona, view || undefined) },
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
    const forwardStripped = (delta: string): void => {
      if (!onDelta) return;
      if (leadResolved) return emit(delta);
      pendingLead += delta;
      const match = EMOTION_TAG.exec(pendingLead);
      if (match) {
        leadResolved = true;
        emit(pendingLead.slice(match[0].length));
        pendingLead = "";
        return;
      }
      // 只有前导空白、或空白后以 [ 开头:仍可能构成表情前缀,继续扣住(S3);
      // 长度上限按去掉空白的部分算,空白不占标签预算。
      const rest = pendingLead.trimStart();
      if (rest === "" || rest.startsWith("[")) {
        if (rest !== "" && [...rest].length > EMOTION_TAG_MAX_CHARS) {
          leadResolved = true;
          emit(pendingLead);
          pendingLead = "";
        }
        return;
      }
      leadResolved = true;
      emit(pendingLead);
      pendingLead = "";
    };
    /** 流结束(S3):前缀一直没判定成(如「[好]」),扣住的字符按正文补放,不丢字。 */
    const flushPendingLead = (): void => {
      if (leadResolved || pendingLead === "") return;
      leadResolved = true;
      const rest = EMOTION_TAG.exec(pendingLead) ? pendingLead.replace(EMOTION_TAG, "") : pendingLead;
      pendingLead = "";
      emit(rest);
    };
    try {
      const raw = await this.deps.model.completeStream(messages, forwardStripped);
      flushPendingLead();
      const { text: body, emotion } = stripEmotionTag(raw.trim());
      const cleaned = truncateChars(this.deps.redact(body), CHAT_MAX_CHARS);
      const quickActions = detectQuickActions(text);
      return {
        ticketId: ticket.id,
        status: "ready",
        text: cleaned,
        ...(emotion ? { emotion } : {}),
        ...(quickActions.length > 0 ? { quickActions } : {}),
      };
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      // 半截正文已经上屏(S2):不再退回 demo 流,直接以 failed 收口——
      // 否则面板会把演示话术接在半截真实输出后面,拼成两段不相干的话。
      if (streamed) {
        return { ticketId: ticket.id, status: "failed", text: `真实模型没接上：${reason}。刚才那句只说了一半，再说一遍？` };
      }
      // 一个字都没流出:落 failed 写明原因,退回 demo 脚本(工单 11:桌宠不卡死)。
      await onReport({
        ticketId: ticket.id,
        status: "failed",
        text: `真实模型没接上：${reason}。先用演示话回你。`,
      });
      return this.runDemoChat(ticket, text, onDelta);
    }
  }

  /** 演示对话(无 key/回退):脚本回复分拍流出,Report 带表情与建议,与真实模型同形状。 */
  private async runDemoChat(
    ticket: AgentTicket,
    text: string,
    onDelta?: (delta: string) => void,
  ): Promise<AgentReport> {
    const { text: body, emotion } = stripEmotionTag(demoChatReply(text));
    const chars = [...truncateChars(this.deps.redact(body), CHAT_MAX_CHARS)];
    for (let start = 0; start < chars.length; start += DEMO_CHAT_CHUNK_CHARS) {
      if (start > 0) await this.deps.sleep(DEMO_CHAT_STEP_MS);
      onDelta?.(this.deps.redact(chars.slice(start, start + DEMO_CHAT_CHUNK_CHARS).join("")));
    }
    const quickActions = detectQuickActions(text);
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
      await onReport({
        ticketId: ticket.id,
        status: "failed",
        text: `真实模型没接上：${(error as Error).message.slice(0, 200)}。先用演示草稿顶上。`,
      });
      return { ticketId: ticket.id, status: "waiting", text: this.deps.demoText };
    }
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
}): AgentWorker {
  const demo = new DemoWorker(deps.demoSleep ? { sleep: deps.demoSleep } : undefined);
  const persona = deps.persona ?? DEFAULT_PET_PERSONA;
  const chat = new ChatWorker({
    model: deps.routerModel,
    persona,
    redact: deps.redact ?? noRedact,
    sleep: deps.demoChatSleep ?? defaultSleep,
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
      if (trigger.kind === "research-due") return research.run(ticket, trigger, options);
      if (trigger.kind === "cards-published") return blindspot.run(ticket, trigger, options);
      return demo.run(ticket, trigger, options);
    },
  };
}
