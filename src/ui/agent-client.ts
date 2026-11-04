/**
 * 桌宠 Agent 的前端客户端(工单 03):UI 通过它与编排层通信,
 * 只用两个动作——sendCommand 发命令(POST /api/agent/triggers)、
 * onEvent 订阅事件流(SSE /api/agent/events)。fetch 与 EventSource 可注入,
 * 测试用假实现(见 agent-client.test.ts);生产缺省用浏览器全局实现。
 */
import type { AgentEvent, AgentTicketView } from "../../server/agent/types";

/** 注入缝:测试传假 fetch / 假 EventSource;缺省回落浏览器全局。 */
export interface AgentClientDeps {
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
  baseUrl?: string;
}

export interface AgentClient {
  /** 把一句命令作为 pet 触发给 Router;失败抛错误消息(UI 层展示)。 */
  sendCommand(text: string): Promise<void>;
  /** 订阅 Report 与 Channel 事件;返回退订函数。 */
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /** 拉取工单视图(账本折叠的最新状态;工单 05);失败抛错误消息。 */
  tickets(): Promise<AgentTicketView[]>;
}

export function createAgentClient(deps: AgentClientDeps = {}): AgentClient {
  const { baseUrl = "" } = deps;

  return {
    async sendCommand(text) {
      const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
      const response = await doFetch(`${baseUrl}/api/agent/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "pet", kind: "command", data: { text } }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `命令发送失败(HTTP ${response.status})`);
      }
    },

    async tickets() {
      const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
      const response = await doFetch(`${baseUrl}/api/agent/tickets`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `工单查询失败(HTTP ${response.status})`);
      }
      return (await response.json()) as AgentTicketView[];
    },

    onEvent(listener) {
      // jsdom 等无 EventSource 的环境(如 App 级测试)静默不订阅,不阻断渲染。
      const Source = deps.EventSource ?? globalThis.EventSource;
      if (!Source) return () => undefined;
      const source = new Source(`${baseUrl}/api/agent/events`);
      // 服务端事件格式(server/app-server.ts):event: report|channel,data: {report}|{channel}。
      const dispatch = (event: MessageEvent): void => {
        const payload = JSON.parse((event.data ?? "{}") as string) as {
          report?: Extract<AgentEvent, { type: "report" }>["report"];
          channel?: Extract<AgentEvent, { type: "channel" }>["channel"];
        };
        if (payload.report) listener({ type: "report", report: payload.report });
        if (payload.channel) listener({ type: "channel", channel: payload.channel });
      };
      source.addEventListener("report", dispatch);
      source.addEventListener("channel", dispatch);
      return () => source.close();
    },
  };
}
