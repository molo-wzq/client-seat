import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_MAX, loadChatHistory, serializeChat, type PetChatMessage } from "./chat-history";

/**
 * 工单 15 测试缝(纯函数,审查 S6):本地对话历史的校验、截断与序列化。
 * 落盘数据不受信任:坏条目丢弃、未知字段不带回,渲染层永不因存量数据崩。
 */

describe("loadChatHistory(工单 15,审查 S6)", () => {
  it("null/坏 JSON/非数组都当空历史", () => {
    expect(loadChatHistory(null)).toEqual([]);
    expect(loadChatHistory("{oops")).toEqual([]);
    expect(loadChatHistory('{"speaker":"pet"}')).toEqual([]);
    expect(loadChatHistory("42")).toEqual([]);
  });

  it("只认 {speaker, text}:说话人非法或正文非字符串的条目整条丢弃", () => {
    const raw = JSON.stringify([
      { speaker: "player", text: "在吗" },
      { speaker: "manager", text: "冒充的" },
      { speaker: "pet", text: 42 },
      null,
      "plain string",
      { text: "没说话人" },
      { speaker: "pet", text: "我在呢" },
    ]);
    expect(loadChatHistory(raw)).toEqual([
      { key: "h0", speaker: "player", text: "在吗" },
      { key: "h1", speaker: "pet", text: "我在呢" },
    ]);
  });

  it("旧的建议动作按钮不读回来,未知字段一并丢弃", () => {
    const raw = JSON.stringify([
      {
        speaker: "pet",
        text: "好，这就去安排。",
        quickActions: ["换个客户", "再来一局"],
        actions: ["换个客户"],
        key: "inject",
        ticketId: "t-x",
        streaming: true,
      },
      { speaker: "pet", text: "x" },
    ]);
    expect(loadChatHistory(raw)).toEqual([
      { key: "h0", speaker: "pet", text: "好，这就去安排。" },
      { key: "h1", speaker: "pet", text: "x" },
    ]);
  });

  it("只保留最近 50 条,超出的旧话截掉", () => {
    const raw = JSON.stringify(
      Array.from({ length: 60 }, (_, index) => ({ speaker: "pet" as const, text: `旧话${index}` })),
    );
    const loaded = loadChatHistory(raw);
    expect(loaded).toHaveLength(CHAT_HISTORY_MAX);
    expect(loaded[0]).toEqual({ key: "h0", speaker: "pet", text: "旧话10" });
    expect(loaded.at(-1)).toEqual({ key: "h49", speaker: "pet", text: "旧话59" });
  });
});

describe("serializeChat(工单 15,R1)", () => {
  /** 一条消息的速记工厂。 */
  function msg(speaker: PetChatMessage["speaker"], text: string, extra: Partial<PetChatMessage> = {}): PetChatMessage {
    return { key: `${speaker}-${text}`, speaker, text, ...extra };
  }

  it("只存说话人与正文:流式标记、工单号、key 一律不落", () => {
    const out = serializeChat([
      msg("player", "在吗"),
      { key: "s", ticketId: "t-1", speaker: "pet", text: "还在逐字到", streaming: true },
      msg("pet", "我在呢", { ticketId: "t-1" }),
    ]);
    expect(JSON.parse(out)).toEqual([
      { speaker: "player", text: "在吗" },
      { speaker: "pet", text: "我在呢" },
    ]);
  });

  it("同样只取最近 50 条,建议动作不落盘", () => {
    const many: PetChatMessage[] = Array.from({ length: 55 }, (_, index) => msg("player", `话${index}`));
    many.push(msg("pet", "好，这就去安排。"));
    const out = JSON.parse(serializeChat(many)) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(CHAT_HISTORY_MAX);
    expect(out[0]).toEqual({ speaker: "player", text: "话6" });
    expect(out.at(-1)).toEqual({ speaker: "pet", text: "好，这就去安排。" });
  });
});
