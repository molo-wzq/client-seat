/**
 * 本地对话历史的纯读写(工单 12 起,工单 15 抽成模块,审查 S6):
 * localStorage 里的存量数据不受信任——校验、截断、剥离未知字段都在这里,
 * 渲染层拿到的永远是形状合法的消息,不会因坏数据崩掉整个应用。
 */
import { QUICK_RING } from "./pet-reactions";

/** 本地对话历史上限:渲染与存储同一口径(最近 50 条)。 */
export const CHAT_HISTORY_MAX = 50;

/**
 * 对话面板的一条消息(工单 12 起):ticketId 只在本次会话内有值,
 * 落 localStorage 时只存说话人与正文。streaming 表示正文还在逐字到达。
 */
export interface PetChatMessage {
  key: string;
  /** 关联的对话工单号(pet 回复才有):流式 delta 与最终 Report 按它对上。 */
  ticketId?: string;
  speaker: "player" | "pet";
  text: string;
  streaming?: boolean;
  /** 快捷动作建议(工单 11/12):渲染成按钮,点了才执行。 */
  quickActions?: string[];
}

/** 存量条目的合法说话人。 */
function isSpeaker(value: unknown): value is "player" | "pet" {
  return value === "player" || value === "pet";
}

/** quickActions 只认快捷动作文案里的字符串项(审查 S6:坏值整段剥掉)。 */
const QUICK_ACTION_SET: ReadonlySet<string> = new Set(QUICK_RING);

function validQuickActions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((item): item is string => typeof item === "string" && QUICK_ACTION_SET.has(item));
  return kept.length > 0 ? kept : undefined;
}

/**
 * 读历史:坏 JSON/非数组当空;条目只认 {speaker,text[,quickActions]},
 * 其余字段(key/ticketId/streaming…)一律丢弃,不原样展开(审查 S6);
 * 只留最近 CHAT_HISTORY_MAX 条,key 按 h 序号重排。
 */
export function loadChatHistory(raw: string | null): PetChatMessage[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is { speaker: "player" | "pet"; text: string; quickActions?: unknown } =>
        typeof item === "object" && item !== null && isSpeaker((item as { speaker?: unknown }).speaker) && typeof (item as { text?: unknown }).text === "string",
    )
    .slice(-CHAT_HISTORY_MAX)
    .map((item, index) => {
      const quickActions = validQuickActions(item.quickActions);
      return {
        key: `h${index}`,
        speaker: item.speaker,
        text: item.text,
        ...(quickActions ? { quickActions } : {}),
      };
    });
}

/**
 * 写历史:只存 {speaker,text[,quickActions]},流式条目不落(定稿才有),
 * 同样截到最近 CHAT_HISTORY_MAX 条。调用方比对串相同就跳过写盘(R1:流式期间不重复写)。
 */
export function serializeChat(messages: PetChatMessage[]): string {
  return JSON.stringify(
    messages
      .filter((message) => !message.streaming)
      .slice(-CHAT_HISTORY_MAX)
      .map(({ speaker, text, quickActions }) => ({
        speaker,
        text,
        ...(quickActions && quickActions.length > 0 ? { quickActions } : {}),
      })),
  );
}
