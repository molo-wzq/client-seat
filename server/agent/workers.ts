import { DemoWorker, type AgentWorker, type ReportSink } from "./core";
import type { AgentReport, AgentTicket, AgentTrigger, PetEmotion } from "./types";
import { DEFAULT_PET_PERSONA, PET_EMOTIONS, assemblePetSystemPrompt, type PetPersonaCard } from "./pet-persona";
// PET_EMOTIONS 仅用于拼 EMOTION_TAG 正则与上限,标签语义见 pet-persona.ts。

/**
 * 真实模型 Worker(工单 11):有 key 走模型,没 key 或出错退回 demo,演示不断。
 * - 对话 Worker(chat):桌宠以人格卡口吻回玩家,流式 delta、表情剥离、快捷动作建议;
 * - 投研/盲区 Worker(research-due / cards-published):只产 waiting 草稿,人审闸门不变
 *   (ADR 0007)——Worker 手上没有任何发布接口,草稿永远到不了牌桌。
 * 隔离:hidden 原文只用来「从落账文本里抹掉自己」,绝不进模型提示词——
 * 模型不知道的内容,也就无从往外说。
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

/** 表情前缀:模型按提示词约定开头,如「[cheer]正文」;标签表与提示词同源(pet-persona)。 */
const EMOTION_TAG = new RegExp(`^\\[(${PET_EMOTIONS.join("|")})\\]\\s*`);
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

/** 抹掉隐藏牌原文:替换成占位,落账字段(Report 文本)一个字不留。 */
function redactHidden(text: string, hidden: string[]): string {
  let result = text;
  for (const entry of hidden) {
    if (entry) result = result.split(entry).join("（这块先不记）");
  }
  return result;
}

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

/** 对话 Worker:走 Router(轻量)模型;出错/无 key 退回 demo,桌宠不卡死。 */
class ChatWorker implements AgentWorker {
  constructor(
    private readonly deps: { model?: AgentModelPort; demo: AgentWorker; persona: PetPersonaCard },
  ) {}

  async run(
    ticket: AgentTicket,
    trigger: AgentTrigger,
    onReport: ReportSink,
    onDelta?: (text: string) => void,
  ): Promise<AgentReport> {
    const text = asText(trigger.data.text);
    // 无 key:直接走 demo 脚本回复,演示模式完整可用。
    if (!this.deps.model) return this.deps.demo.run(ticket, trigger, onReport);
    const hidden = asTextArray(trigger.data.hidden);
    const view = asText(trigger.data.view);
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
    const emit = (piece: string): void => {
      if (!onDelta || piece === "" || emittedChars >= CHAT_MAX_CHARS) return;
      const room = CHAT_MAX_CHARS - emittedChars;
      const out = [...piece].slice(0, room).join("");
      emittedChars += [...out].length;
      onDelta(out);
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
      if (!pendingLead.startsWith("[")) {
        leadResolved = true;
        emit(pendingLead);
        pendingLead = "";
        return;
      }
      // 还是「可能是前缀」的形状:攒着;超过前缀最大长度仍不是标签,按正文放行。
      if ([...pendingLead].length > EMOTION_TAG_MAX_CHARS) {
        leadResolved = true;
        emit(pendingLead);
        pendingLead = "";
      }
    };
    try {
      const raw = await this.deps.model.completeStream(messages, forwardStripped);
      const { text: body, emotion } = stripEmotionTag(raw.trim());
      const cleaned = truncateChars(redactHidden(body, hidden), CHAT_MAX_CHARS);
      const quickActions = detectQuickActions(text);
      return {
        ticketId: ticket.id,
        status: "ready",
        text: cleaned,
        ...(emotion ? { emotion } : {}),
        ...(quickActions.length > 0 ? { quickActions } : {}),
      };
    } catch (error) {
      // 出错或超时:落 failed 写明原因,退回 demo 回复(工单 11:桌宠不卡死)。
      await onReport({
        ticketId: ticket.id,
        status: "failed",
        text: `真实模型没接上：${(error as Error).message.slice(0, 200)}。先用演示话回你。`,
      });
      return this.deps.demo.run(ticket, trigger, onReport);
    }
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

  async run(ticket: AgentTicket, trigger: AgentTrigger, onReport: ReportSink): Promise<AgentReport> {
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
}): AgentWorker {
  const demo = new DemoWorker();
  const persona = deps.persona ?? DEFAULT_PET_PERSONA;
  const chat = new ChatWorker({ model: deps.routerModel, demo, persona });
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
    async run(ticket, trigger, onReport, onDelta) {
      if (trigger.kind === "chat") return chat.run(ticket, trigger, onReport, onDelta);
      if (trigger.kind === "research-due") return research.run(ticket, trigger, onReport);
      if (trigger.kind === "cards-published") return blindspot.run(ticket, trigger, onReport);
      return demo.run(ticket, trigger, onReport);
    },
  };
}
