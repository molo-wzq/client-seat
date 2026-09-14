import type { ProductStorage } from "./ports";
import type { Conversation } from "./types";

/**
 * 对话存储上限策略(spec:.scratch/conversation-retention/spec.md)。
 * 时间与条数两条规则取并集;null 表示该维度不限。
 * 不区分 ongoing/ended:废弃的进行中通话同样是存储负担。
 */
export interface ConversationRetentionPolicy {
  /** 对话最长保留时长(毫秒),按 createdAt 计。 */
  maxAgeMs: number | null;
  /** 最多保留的对话条数,超出部分从最旧一端淘汰。 */
  maxCount: number | null;
}

/** 两维度都不限:等价于没有保留策略(测试与未配置时的缺省)。 */
export const NO_RETENTION: ConversationRetentionPolicy = { maxAgeMs: null, maxCount: null };

/**
 * 创建时间倒序比较器,与 listConversations 的展示口径同一:同毫秒创建时以 id
 * 作次级键,保证比较器一致、排序稳定。保留策略"从最旧一端淘汰"也用它。
 */
export function compareConversationsByRecency(a: Conversation, b: Conversation): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** createdAt 解析失败(脏数据)按最早时间处理:让两条规则都优先淘汰它。 */
function createdAtMs(conversation: Conversation): number {
  const parsed = Date.parse(conversation.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 计算应清理的对话 id:时间过期 ∪ 超出条数上限的最旧部分。
 * 纯函数,不触碰存储;调用方拿快照即可。
 */
export function selectConversationsToPurge(
  conversations: Conversation[],
  now: Date,
  policy: ConversationRetentionPolicy,
): string[] {
  if (policy.maxAgeMs === null && policy.maxCount === null) return [];
  const purge = new Set<string>();

  if (policy.maxAgeMs !== null) {
    const deadline = now.getTime() - policy.maxAgeMs;
    for (const conversation of conversations) {
      if (createdAtMs(conversation) < deadline) purge.add(conversation.id);
    }
  }

  if (policy.maxCount !== null && conversations.length > policy.maxCount) {
    const oldest = [...conversations].sort(compareConversationsByRecency).slice(policy.maxCount);
    for (const conversation of oldest) purge.add(conversation.id);
  }

  return [...purge];
}

/** 对存储执行一次清理,返回被清理的对话 id(供组合根打日志与测试断言)。 */
export async function purgeExpiredConversations(
  storage: Pick<ProductStorage, "listConversations" | "deleteConversations">,
  now: Date,
  policy: ConversationRetentionPolicy,
): Promise<string[]> {
  const conversations = await storage.listConversations();
  const ids = selectConversationsToPurge(conversations, now, policy);
  if (ids.length > 0) await storage.deleteConversations(ids);
  return ids;
}
