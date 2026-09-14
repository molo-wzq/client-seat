import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { InMemoryStorage } from "../product/in-process-product-api";
import { SEED_PERSONAS } from "./seed";
import { createProductCore } from "./product-core";
import {
  compareConversationsByRecency,
  NO_RETENTION,
  purgeExpiredConversations,
  selectConversationsToPurge,
  type ConversationRetentionPolicy,
} from "./conversation-retention";
import type { Conversation } from "./types";

const NOW = new Date("2026-09-12T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function conversation(id: string, createdAt: string): Conversation {
  return { id, personaId: "p01", status: "ended", turns: [], createdAt };
}

describe("对话保留策略:纯函数", () => {
  it("不限策略(两个维度都为 null)不清理任何对话", () => {
    const conversations = [conversation("c1", "2000-01-01T00:00:00.000Z")];
    expect(selectConversationsToPurge(conversations, NOW, NO_RETENTION)).toEqual([]);
  });

  it("超过保留时间的对话被清理,边界上的保留(恰好在保留期内)", () => {
    const policy: ConversationRetentionPolicy = { maxAgeMs: 7 * DAY_MS, maxCount: null };
    const conversations = [
      conversation("old", "2026-09-01T00:00:00.000Z"), // 超过 7 天前
      conversation("edge", "2026-09-05T08:00:00.000Z"), // 恰好 7 天,未过期
      conversation("new", "2026-09-12T07:00:00.000Z"),
    ];
    expect(selectConversationsToPurge(conversations, NOW, policy)).toEqual(["old"]);
  });

  it("超出条数上限时从最旧一端淘汰,同毫秒按 id 次级键定序", () => {
    const policy: ConversationRetentionPolicy = { maxAgeMs: null, maxCount: 2 };
    const sameTime = "2026-09-10T00:00:00.000Z";
    const conversations = [
      conversation("c-new", "2026-09-12T00:00:00.000Z"),
      conversation("c-b", sameTime),
      conversation("c-a", sameTime),
      conversation("c-old", "2026-09-01T00:00:00.000Z"),
    ];
    // 保留最新的两通:c-new 与同毫秒中 id 较大的 c-b;淘汰 c-a 与 c-old。
    expect(selectConversationsToPurge(conversations, NOW, policy).sort()).toEqual(["c-a", "c-old"]);
  });

  it("时间与条数取并集,不重复计数", () => {
    const policy: ConversationRetentionPolicy = { maxAgeMs: 7 * DAY_MS, maxCount: 2 };
    const conversations = [
      conversation("expired", "2026-08-01T00:00:00.000Z"), // 时间过期
      conversation("a", "2026-09-10T00:00:00.000Z"),
      conversation("b", "2026-09-11T00:00:00.000Z"),
      conversation("overflow", "2026-09-09T00:00:00.000Z"), // 未过期但排第 3,超量
    ];
    expect(selectConversationsToPurge(conversations, NOW, policy).sort()).toEqual(["expired", "overflow"]);
  });

  it("createdAt 脏数据(无法解析)按最早时间处理,优先淘汰", () => {
    const policy: ConversationRetentionPolicy = { maxAgeMs: DAY_MS, maxCount: null };
    const conversations = [conversation("dirty", "not-a-date"), conversation("ok", NOW.toISOString())];
    expect(selectConversationsToPurge(conversations, NOW, policy)).toEqual(["dirty"]);
  });

  it("排序比较器:创建时间倒序,id 为次级键", () => {
    const a = conversation("a", "2026-09-10T00:00:00.000Z");
    const b = conversation("b", "2026-09-11T00:00:00.000Z");
    const c = conversation("c", "2026-09-10T00:00:00.000Z");
    expect([b, a, c].sort(compareConversationsByRecency).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});

describe("对话保留策略:purge helper", () => {
  it("命中策略的对话被删除,返回被清理 id;未命中时不发起删除", async () => {
    const storage = new InMemoryStorage();
    const keep = conversation("keep", NOW.toISOString());
    const drop = conversation("drop", "2026-08-01T00:00:00.000Z");
    await storage.saveConversation(keep);
    await storage.saveConversation(drop);

    const purged = await purgeExpiredConversations(storage, NOW, { maxAgeMs: 7 * DAY_MS, maxCount: null });
    expect(purged).toEqual(["drop"]);
    expect((await storage.listConversations()).map((c) => c.id)).toEqual(["keep"]);
  });
});

describe("对话保留策略:领域核心集成", () => {
  function setup(retention: ConversationRetentionPolicy, startAt = NOW.getTime()) {
    let clock = startAt;
    const api = createProductCore({
      copywriting: new FakeModelAdapter(),
      dialogue: new FakeModelAdapter(),
      storage: new InMemoryStorage(),
      retention,
      now: () => new Date(clock),
    });
    return {
      api,
      /** 每开一通新通话,时钟前进 1 分钟,保证创建时间严格递增可断言。 */
      async startCall() {
        clock += 60 * 1000;
        return api.startConversation(SEED_PERSONAS[0]!.id);
      },
      async storedIds() {
        return (await api.listConversations()).map((c) => c.id);
      },
    };
  }

  it("条数上限:开新通话自动挤掉最旧的一通", async () => {
    const { api, startCall, storedIds } = setup({ maxAgeMs: null, maxCount: 2 });
    const first = await startCall();
    await startCall();
    await startCall();

    const remaining = await storedIds();
    expect(remaining).toHaveLength(2);
    expect(remaining).not.toContain(first.id);
    // 最先创建的那通已被清理:按核心契约以 404 报"通话不存在"。
    await expect(api.getConversation(first.id)).rejects.toThrow("通话不存在");
  });

  it("时间上限:超过保留期的对话在开新通话时被清理", async () => {
    // 预置一通 8 天前的旧对话;保留期 7 天,开新通话时应触发清理。
    const storage = new InMemoryStorage();
    await storage.saveConversation(conversation("stale", new Date(NOW.getTime() - 8 * DAY_MS).toISOString()));
    const api = createProductCore({
      copywriting: new FakeModelAdapter(),
      dialogue: new FakeModelAdapter(),
      storage,
      retention: { maxAgeMs: 7 * DAY_MS, maxCount: null },
      now: () => NOW,
    });

    const fresh = await api.startConversation(SEED_PERSONAS[0]!.id);

    expect((await api.listConversations()).map((c) => c.id)).toEqual([fresh.id]);
    await expect(api.getConversation("stale")).rejects.toThrow("通话不存在");
  });

  it("未配置策略时行为不变:对话只累积不清理", async () => {
    const { startCall, storedIds } = setup(NO_RETENTION);
    await startCall();
    await startCall();
    await startCall();
    expect(await storedIds()).toHaveLength(3);
  });
});
