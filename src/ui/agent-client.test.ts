import { describe, expect, it } from "vitest";
import { createAgentClient } from "./agent-client";
import type { AgentTriggerInput } from "../shared/agent-contract";

/**
 * 前端 agent 客户端(工单 03 测试缝):fetch 与 EventSource 均注入假实现,
 * 只钉 HTTP/SSE 的外部行为——发给哪个端点、什么载荷、事件如何翻译给 UI。
 */

/** 结构化 fetch 假实现:记下调用,回可配置的 JSON 响应。 */
type FetchCall = { url: string; init?: RequestInit };

function fakeFetch(result: { ok: boolean; status: number; body: unknown }) {
  const calls: FetchCall[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

/** EventSource 假实现:记下订阅的 URL 与事件监听,测试里手动 emit。 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Array<(event: { data: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** 模拟服务端写出一条 SSE 事件。 */
  emit(name: string, payload: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(payload) });
    }
  }
}

describe("agent 客户端 sendCommand", () => {
  it("以 pet command 触发发 POST /api/agent/triggers", async () => {
    const fetch = fakeFetch({ ok: true, status: 200, body: { admitted: true } });
    const client = createAgentClient({ fetch: fetch.fn });

    await client.sendCommand("换个客户");

    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe("/api/agent/triggers");
    expect(fetch.calls[0].init?.method).toBe("POST");
    expect(fetch.calls[0].init?.body).toBe(
      JSON.stringify({ source: "pet", kind: "command", data: { text: "换个客户" } }),
    );
  });

  it("服务端拒绝时抛出错误消息", async () => {
    const fetch = fakeFetch({ ok: false, status: 400, body: { error: "命令内容为空" } });
    const client = createAgentClient({ fetch: fetch.fn });

    await expect(client.sendCommand("  ")).rejects.toThrow("命令内容为空");
  });
});

describe("agent 客户端 sendTrigger", () => {
  it("把任意触发 POST 到 /api/agent/triggers,并返回链路结果(工单 06 结算页自动复盘)", async () => {
    const outcome = {
      triggerId: "tr-1",
      admitted: true,
      ticket: null,
      report: { ticketId: "t-1", status: "ready", text: "第2轮先接住话头再往下谈，这招值得学。" },
    };
    const fetch = fakeFetch({ ok: true, status: 200, body: outcome });
    const client = createAgentClient({ fetch: fetch.fn });

    await expect(
      client.sendTrigger({
        source: "table",
        kind: "game-ended",
        data: { gameId: "conv-1", rounds: [{ managerText: "您好。", cardId: "c1" }], hiddenUnrevealedCount: 1 },
      }),
    ).resolves.toEqual(outcome);

    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe("/api/agent/triggers");
    expect(fetch.calls[0].init?.method).toBe("POST");
    expect(fetch.calls[0].init?.body).toBe(
      JSON.stringify({
        source: "table",
        kind: "game-ended",
        data: { gameId: "conv-1", rounds: [{ managerText: "您好。", cardId: "c1" }], hiddenUnrevealedCount: 1 },
      }),
    );
  });

  it("服务端拒绝时抛出错误消息", async () => {
    const fetch = fakeFetch({ ok: false, status: 400, body: { error: "触发类型不合法" } });
    const client = createAgentClient({ fetch: fetch.fn });

    await expect(
      client.sendTrigger({ source: "table", kind: "magic" as AgentTriggerInput["kind"], data: {} }),
    ).rejects.toThrow("触发类型不合法");
  });
});

describe("agent 客户端 tickets", () => {
  it("GET /api/agent/tickets,返回账本折叠出的工单视图", async () => {
    const tickets = [
      { ticketId: "t-1", status: "waiting", text: "等你拍板" },
      { ticketId: "t-2", status: "ready", text: "办完了" },
    ];
    const fetch = fakeFetch({ ok: true, status: 200, body: tickets });
    const client = createAgentClient({ fetch: fetch.fn });

    await expect(client.tickets()).resolves.toEqual(tickets);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe("/api/agent/tickets");
    expect(fetch.calls[0].init?.method).toBeUndefined();
  });

  it("服务端出错时抛出错误消息", async () => {
    const fetch = fakeFetch({ ok: false, status: 500, body: { error: "账本不可读" } });
    const client = createAgentClient({ fetch: fetch.fn });

    await expect(client.tickets()).rejects.toThrow("账本不可读");
  });
});

describe("agent 客户端 onEvent", () => {
  it("订阅 /api/agent/events,把 report/channel SSE 事件翻译给监听者;退订即关闭连接", () => {
    FakeEventSource.instances = [];
    const client = createAgentClient({ EventSource: FakeEventSource as unknown as typeof EventSource });
    const events: unknown[] = [];

    const unsubscribe = client.onEvent((event) => events.push(event));
    const source = FakeEventSource.instances[0];
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe("/api/agent/events");

    source.emit("report", { report: { ticketId: "t1", status: "ready", text: "收到，马上办" } });
    source.emit("channel", { channel: { target: "pet-bubble", ticketId: "t1", text: "收到，马上办" } });
    expect(events).toEqual([
      { type: "report", report: { ticketId: "t1", status: "ready", text: "收到，马上办" } },
      { type: "channel", channel: { target: "pet-bubble", ticketId: "t1", text: "收到，马上办" } },
    ]);

    unsubscribe();
    expect(source.closed).toBe(true);
  });

  it("delta SSE 事件(工单 11 流式对话)翻译给监听者:ticketId + 文本片段", () => {
    FakeEventSource.instances = [];
    const client = createAgentClient({ EventSource: FakeEventSource as unknown as typeof EventSource });
    const events: unknown[] = [];

    const unsubscribe = client.onEvent((event) => events.push(event));
    const source = FakeEventSource.instances[0];

    source.emit("delta", { delta: { ticketId: "t1", text: "来了来" } });
    source.emit("delta", { delta: { ticketId: "t1", text: "了，我听着呢。" } });
    expect(events).toEqual([
      { type: "delta", ticketId: "t1", text: "来了来" },
      { type: "delta", ticketId: "t1", text: "了，我听着呢。" },
    ]);

    unsubscribe();
    expect(source.closed).toBe(true);
  });
});
