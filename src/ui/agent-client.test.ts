import { describe, expect, it } from "vitest";
import { createAgentClient } from "./agent-client";

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
});
