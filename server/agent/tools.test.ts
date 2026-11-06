import { describe, expect, it } from "vitest";
import type { AgentReport, AgentTicket, AgentTrigger } from "./types";
import { createAgentCore, type ReportSink } from "./core";
import {
  createModelWorkers,
  PET_TOOL_SPECS,
  type AgentModelMessage,
  type AgentModelPort,
  type AgentToolCall,
  type AgentToolResult,
  type AgentToolSpec,
  type PetToolSources,
} from "./workers";
import { InMemoryLedgerStorage } from "./storage";

/**
 * 只读工具与 function calling(工单 16)测试缝:假模型端口,不发网络请求。
 * - 工具调用链路:模型发起 tool_calls → progress 事件(工具名+一句中文)→ 工具结果回模型 → 最终回复;
 * - 四个只读工具的数据从注入的数据源/牌局快照取,不接外网;
 * - 最多 3 轮工具调用,超出后强制收口;
 * - 无 key 时 demo 用脚本模拟一次工具调用;
 * - 模型未实现 completeWithTools(或链上都不支持)时退回纯对话,不报错。
 */

/** 假模型端口:按剧本回放「工具调用 → 正文」两段;记录每次收到的消息与工具定义。 */
class ScriptedToolModel implements AgentModelPort {
  readonly calls: Array<{ messages: AgentModelMessage[]; tools?: AgentToolSpec[] }> = [];
  private script: Array<AgentToolResult | Error> = [];

  /** 剧本:依次回放;耗尽后回固定正文。 */
  enqueue(step: AgentToolResult | Error): void {
    this.script.push(step);
  }

  async completeStream(messages: AgentModelMessage[]): Promise<string> {
    this.calls.push({ messages: messages.map((message) => ({ ...message })) });
    return "[wave]好,我先记着。";
  }

  async completeWithTools(messages: AgentModelMessage[], tools?: AgentToolSpec[]): Promise<AgentToolResult> {
    this.calls.push({ messages: messages.map((message) => ({ ...message })), tools });
    const step = this.script.shift();
    if (step instanceof Error) throw step;
    return step ?? { type: "text", text: "[cheer]查到了,这就说给你听。" };
  }
}

function toolCall(name: string, args: Record<string, unknown> = {}): AgentToolCall {
  return { id: `call-${name}`, name, arguments: JSON.stringify(args) };
}

/** 只读数据源假实现:记录调用,返回可断言的文本。 */
function fakeSources(log: string[] = []): PetToolSources {
  return {
    weeklyResearch: async () => {
      log.push("weeklyResearch");
      return "本周要点:利率窗口临近,防御为先。";
    },
    searchCards: async (keyword) => {
      log.push(`searchCards:${keyword}`);
      return `找到 1 张卡:存款搬家(出处:外呼录音A T01–T02)`;
    },
    lastReview: async () => {
      log.push("lastReview");
      return "上一局:第 2 轮用「存款搬家」收口成功。";
    },
  };
}

function chatTrigger(text: string, data: Record<string, unknown> = {}): AgentTrigger {
  return {
    id: `tr-${Math.random().toString(36).slice(2, 8)}`,
    source: "pet",
    kind: "chat",
    data: { text, ...data },
  };
}

function ticketOf(trigger: AgentTrigger): AgentTicket {
  return { id: "t-chat", triggerId: trigger.id, thread: { kind: "commandId", key: trigger.id } };
}

const gameSnapshot = {
  phase: "game" as const,
  customer: { name: "陈建国", visible: ["存款 80 万"] },
  hiddenCards: ["儿子留学要用 40 万"],
  turns: [],
  cardsPlayed: [],
  turnNumber: 2,
  maxTurns: 12,
  revealedHidden: 0,
};

describe("只读工具与 function calling(工单 16)", () => {
  it("模型发起工具调用:先发 progress(工具名+一句中文),工具结果回模型后出最终回复", async () => {
    const model = new ScriptedToolModel();
    model.enqueue({ type: "tool_calls", calls: [toolCall("get_weekly_research")] });
    const log: string[] = [];
    const worker = createModelWorkers({ routerModel: model, toolSources: fakeSources(log) });
    const reports: AgentReport[] = [];
    const trigger = chatTrigger("这周投研有什么能用的?");

    const report = await worker.run(ticketOf(trigger), trigger, {
      onReport: async (item) => {
        reports.push(item);
      },
    });

    // 工具定义随第一次调用进模型:四个只读工具都在。
    expect(model.calls[0]?.tools?.map((tool) => tool.function.name)).toEqual(
      PET_TOOL_SPECS.map((tool) => tool.function.name),
    );
    // progress 事件:带工具相关的中文一句话,先于最终回复。
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ ticketId: "t-chat", status: "progress" });
    expect(reports[0]!.text).toContain("投研");
    // 工具真的执行了,结果作为 tool 消息回给模型。
    expect(log).toEqual(["weeklyResearch"]);
    const toolMessages = model.calls[1]?.messages.filter((message) => message.role === "tool") ?? [];
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.content).toContain("利率窗口临近");
    expect(toolMessages[0]!.toolCallId).toBe("call-get_weekly_research");
    // 最终回复照常:剥表情、ready。
    expect(report).toMatchObject({ status: "ready", text: "查到了,这就说给你听。", emotion: "cheer" });
  });

  it("get_customer_card 从牌局快照取公开面;search_cards 的关键词透传给数据源", async () => {
    const model = new ScriptedToolModel();
    model.enqueue({
      type: "tool_calls",
      calls: [toolCall("get_customer_card"), toolCall("search_cards", { keyword: "存款搬家" })],
    });
    const log: string[] = [];
    const worker = createModelWorkers({ routerModel: model, toolSources: fakeSources(log) });
    const trigger = chatTrigger("他知不知道我是谁?", { context: gameSnapshot });

    await worker.run(ticketOf(trigger), trigger, { onReport: async () => undefined });

    const toolMessages = model.calls[1]?.messages.filter((message) => message.role === "tool") ?? [];
    const contents = toolMessages.map((message) => message.content);
    // 客户公开面来自快照;两个工具各执行一次,一次 progress 每个工具一条。
    expect(contents[0]).toContain("陈建国");
    expect(contents[0]).toContain("存款 80 万");
    expect(log).toEqual(["searchCards:存款搬家"]);
  });

  it("工具调用最多 3 轮:模型反复要工具时,第 4 次不带工具强制收口", async () => {
    const model = new ScriptedToolModel();
    // 前三轮都要工具,第四段剧本是 completeStream 的固定正文。
    for (let i = 0; i < 3; i += 1) {
      model.enqueue({ type: "tool_calls", calls: [toolCall("get_last_review")] });
    }
    const worker = createModelWorkers({ routerModel: model, toolSources: fakeSources() });
    const reports: AgentReport[] = [];
    const trigger = chatTrigger("再多查几轮试试");

    const report = await worker.run(ticketOf(trigger), trigger, {
      onReport: async (item) => {
        reports.push(item);
      },
    });

    // 三轮工具各一条 progress,不多不少。
    expect(reports.filter((item) => item.status === "progress")).toHaveLength(3);
    // 收口回复来自不带工具的最后一次调用。
    expect(report).toMatchObject({ status: "ready" });
    const lastCall = model.calls.at(-1);
    expect(lastCall?.tools).toBeUndefined();
    expect(lastCall?.messages.filter((message) => message.role === "tool")).toHaveLength(3);
  });

  it("无 key 时 demo 模拟一次工具调用:一条 progress 后照常分拍回复", async () => {
    const worker = createModelWorkers({ demoChatSleep: () => Promise.resolve() });
    const reports: AgentReport[] = [];
    const deltas: string[] = [];
    const trigger = chatTrigger("这周投研帮我划重点");

    const report = await worker.run(ticketOf(trigger), trigger, {
      onReport: async (item) => {
        reports.push(item);
      },
      onDelta: (delta) => deltas.push(delta),
    });

    // 恰好一次模拟工具调用的 progress(工具名 + 一句中文)。
    const progress = reports.filter((item) => item.status === "progress");
    expect(progress).toHaveLength(1);
    expect(progress[0]!.text).toContain("投研");
    // 回复照常分拍流出、ready。
    expect(report.status).toBe("ready");
    expect(deltas.join("")).toBe(report.text);
  });

  it("模型没实现 completeWithTools:退回纯对话流式,不报错(链上不支持也不炸)", async () => {
    const model: AgentModelPort = {
      async completeStream() {
        return "[think]我这边没有查询工具,先按我知道的说。";
      },
    };
    const worker = createModelWorkers({ routerModel: model, toolSources: fakeSources() });
    const trigger = chatTrigger("帮我查点东西");

    const report = await worker.run(ticketOf(trigger), trigger, { onReport: async () => undefined });

    expect(report).toMatchObject({ status: "ready", text: "我这边没有查询工具,先按我知道的说。" });
  });

  it("工具结果与 progress 都走核心公开接口落账:账本里能看到「查了什么」", async () => {
    const model = new ScriptedToolModel();
    model.enqueue({ type: "tool_calls", calls: [toolCall("get_last_review")] });
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: createModelWorkers({ routerModel: model, toolSources: fakeSources() }),
    });

    await core.emitTrigger({ source: "pet", kind: "chat", data: { text: "上局复盘说了啥" } });

    const progressReports = (await core.ledger())
      .filter((entry) => entry.type === "report" && entry.report.status === "progress")
      .map((entry) => (entry.type === "report" ? entry.report.text : ""));
    expect(progressReports).toHaveLength(1);
    expect(progressReports[0]).toContain("复盘");
  });
});
