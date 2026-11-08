/**
 * 本地对话历史的纯读写(工单 12 起,工单 15 抽成模块,审查 S6):
 * localStorage 里的存量数据不受信任——校验、截断、剥离未知字段都在这里,
 * 渲染层拿到的永远是形状合法的消息,不会因坏数据崩掉整个应用。
 */
import type { XiaobeiEvidence } from "../shared/agent-contract";
import { readBotEvidence } from "./bot-notes";

/** 本地对话历史上限:渲染与存储同一口径(最近 50 条)。 */
export const CHAT_HISTORY_MAX = 50;

/** localStorage 键(读写共用,useChatSession 与测试按它落盘/清场)。 */
export const CHAT_KEY = "desk-pet-chat";

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
  emotion?: import("../shared/agent-contract").PetEmotion;
  bot?: { evidence: XiaobeiEvidence[]; steps: string[] };
}

/** 存量条目的合法说话人。 */
function isSpeaker(value: unknown): value is "player" | "pet" {
  return value === "player" || value === "pet";
}

/**
 * 读历史:坏 JSON/非数组当空;条目只认 {speaker,text[,bot]},
 * 建议动作按钮不再读回来(对话不靠点选推进)。
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
      (item): item is { speaker: "player" | "pet"; text: string; bot?: { evidence?: unknown; steps?: unknown } } =>
        typeof item === "object" && item !== null && isSpeaker((item as { speaker?: unknown }).speaker) && typeof (item as { text?: unknown }).text === "string",
    )
    .slice(-CHAT_HISTORY_MAX)
    .map((item, index) => ({
      key: `h${index}`,
      speaker: item.speaker,
      text: item.text,
      ...(item.speaker === "pet" && item.bot && typeof item.bot === "object" ? {
        bot: {
          evidence: readBotEvidence(item.bot.evidence),
          steps: Array.isArray(item.bot.steps)
            ? item.bot.steps.filter((step): step is string => typeof step === "string").slice(0, 12)
            : [],
        },
      } : {}),
    }));
}

/**
 * 写历史:只存 {speaker,text[,bot]},流式条目不落(定稿才有),
 * 同样截到最近 CHAT_HISTORY_MAX 条。调用方比对串相同就跳过写盘(R1:流式期间不重复写)。
 */
export function serializeChat(messages: PetChatMessage[]): string {
  return JSON.stringify(
    messages
      .filter((message) => !message.streaming)
      .slice(-CHAT_HISTORY_MAX)
      .map(({ speaker, text, bot }) => ({
        speaker,
        text,
        ...(bot ? { bot } : {}),
      })),
  );
}
