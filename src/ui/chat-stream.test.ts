import { describe, expect, it } from "vitest";
import type { AgentReport } from "../shared/agent-contract";
import { appendCapped, applyChatReport, mergeDelta } from "./chat-stream";
import type { PetChatMessage } from "./chat-history";

/**
 * 工单 15 测试缝(纯函数,审查 S1/S2/R2):对话流的增量拼接与 Report 定稿。
 * 消息数组的每一次变迁都走这里,面板状态机不再散在组件里。
 */

/** 一条消息的速记工厂。 */
function msg(speaker: PetChatMessage["speaker"], text: string, extra: Partial<PetChatMessage> = {}): PetChatMessage {
  return { key: `${speaker}-${text}`, speaker, text, ...extra };
}

function report(ticketId: string, status: AgentReport["status"], text: string, extra: Partial<AgentReport> = {}): AgentReport {
  return { ticketId, status, text, ...extra };
}

describe("appendCapped(工单 12 起)", () => {
  it("追加新消息并截到最近 50 条", () => {
    const many: PetChatMessage[] = Array.from({ length: 50 }, (_, index) => msg("player", `话${index}`));
    const next = appendCapped(many, msg("pet", "新话"));
    expect(next).toHaveLength(50);
    expect(next.at(-1)?.text).toBe("新话");
    expect(next[0]?.text).toBe("话1");
  });
});

describe("mergeDelta(工单 15,审查 R2)", () => {
  it("首个增量创建流式条目,后续增量按工单号拼接", () => {
    let messages = appendCapped([], msg("player", "在吗"));
    messages = mergeDelta(messages, "t-1", "我在", () => "k1");
    expect(messages.at(-1)).toMatchObject({ ticketId: "t-1", speaker: "pet", text: "我在", streaming: true });
    messages = mergeDelta(messages, "t-1", "呢。", () => "k2");
    expect(messages.at(-1)).toMatchObject({ text: "我在呢。", streaming: true });
    expect(messages).toHaveLength(2); // 没有另起一条
  });

  it("别的工单的增量不动已有条目;同工单定稿后再来增量,原位重开流式(回退路径不拼接怪话)", () => {
    let messages = appendCapped([], msg("player", "在吗"));
    messages = mergeDelta(messages, "t-1", "我在", () => "k1");
    messages = mergeDelta(messages, "t-2", "别串线", () => "k2");
    expect(messages.filter((message) => message.ticketId === "t-1")).toHaveLength(1);
    expect(messages.at(-1)?.text).toBe("别串线");

    // t-1 已经 failed 定稿,真实模型半截报错后 demo 全文重流:旧文被替换,不拼在后面(审查 R2)。
    messages = applyChatReport(messages, report("t-1", "failed", "真实模型没接上。"), () => "k3");
    messages = mergeDelta(messages, "t-1", "我在呢", () => "k4");
    const first = messages.find((message) => message.ticketId === "t-1");
    expect(first).toMatchObject({ text: "我在呢", streaming: true });
    expect(messages.filter((message) => message.ticketId === "t-1")).toHaveLength(1);
  });
});

describe("applyChatReport(工单 15,审查 S1/S2)", () => {
  it("没有 delta 直接到 ready:原位落成定稿消息,不丢回复(审查 S1)", () => {
    let messages = appendCapped([], msg("player", "在吗"));
    messages = applyChatReport(messages, report("t-1", "ready", "我在呢，你说。", { quickActions: ["换个客户"] }), () => "k1");
    expect(messages.at(-1)).toEqual({
      key: expect.any(String),
      ticketId: "t-1",
      speaker: "pet",
      text: "我在呢，你说。",
      quickActions: ["换个客户"],
    });
  });

  it("ready 用服务端权威全文定稿流式条目,带上建议;重复 ready 不再改动", () => {
    let messages = appendCapped([], msg("player", "在吗"));
    messages = mergeDelta(messages, "t-1", "我在", () => "k1");
    messages = applyChatReport(messages, report("t-1", "ready", "我在呢，你说。", { quickActions: ["换个客户"] }), () => "k2");
    const finalized = messages.find((message) => message.ticketId === "t-1");
    expect(finalized).toMatchObject({ text: "我在呢，你说。", streaming: undefined, quickActions: ["换个客户"] });

    const again = applyChatReport(messages, report("t-1", "ready", "我在呢，你说。"), () => "k3");
    expect(again).toBe(messages); // 幂等:同一条 ready 不产生新消息
  });

  it("failed/dropped 也是终态:定稿流式条目;后面的 ready 仍可覆盖成全文(回退路径,审查 S2)", () => {
    let messages = appendCapped([], msg("player", "在吗"));
    messages = mergeDelta(messages, "t-1", "我在", () => "k1");
    messages = applyChatReport(messages, report("t-1", "failed", "真实模型没接上，再说一遍？"), () => "k2");
    expect(messages.find((message) => message.ticketId === "t-1")).toMatchObject({
      text: "真实模型没接上，再说一遍？",
      streaming: undefined,
    });

    messages = applyChatReport(messages, report("t-1", "ready", "我在呢，你说。"), () => "k3");
    const entries = messages.filter((message) => message.ticketId === "t-1");
    expect(entries).toHaveLength(1); // 覆盖同一条,不追加第二条
    expect(entries[0]).toMatchObject({ text: "我在呢，你说。", streaming: undefined });
  });

  it("dropped 定稿且不再有后续:只留一条带说明的消息", () => {
    let messages = appendCapped([], msg("player", "在吗"));
    messages = applyChatReport(messages, report("t-9", "dropped", "这条不做了"), () => "k1");
    expect(messages.at(-1)).toMatchObject({ ticketId: "t-9", text: "这条不做了" });
    expect(messages.at(-1)?.streaming ?? undefined).toBeUndefined();
  });

  it("非终态汇报(progress/waiting/blocked)不动对话消息", () => {
    const messages = appendCapped([], msg("player", "在吗"));
    for (const status of ["progress", "waiting", "blocked"] as const) {
      expect(applyChatReport(messages, report("t-1", status, "途中汇报"), () => "k")).toBe(messages);
    }
  });
});
