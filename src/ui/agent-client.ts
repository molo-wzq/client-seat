/**
 * 桌宠 Agent 的前端客户端(工单 03):UI 通过它与编排层通信,
 * 核心动作是 sendTrigger 发触发(POST /api/agent/triggers,sendCommand 是它的 pet 命令快捷方式)、
 * onEvent 订阅事件流(SSE /api/agent/events)。fetch 与 EventSource 可注入,
 * 测试用假实现(见 agent-client.test.ts);生产缺省用浏览器全局实现。
 */
import type {
  EmitOutcome,
  AcceptMode,
  AgentEvalRecord,
  AgentEvent,
  AgentPolicy,
  AgentTicketView,
  AgentTriggerInput,
} from "../shared/agent-contract";
import type { BotChatEvent, BotChatInput } from "../shared/pet-bot-contract";

/** 注入缝:测试传假 fetch / 假 EventSource;缺省回落浏览器全局。 */
export interface AgentClientDeps {
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
  baseUrl?: string;
}

export interface AgentClient {
  sendBotChat?(input: BotChatInput, onEvent: (event: BotChatEvent) => void): Promise<void>;
  /** 把一句命令作为 pet 触发给 Router;失败抛错误消息(UI 层展示)。 */
  sendCommand(text: string): Promise<void>;
  /** 发任意触发并拿回链路结果(工单 06:结算页自动发 game-ended,读最终 Report);失败抛错误消息。 */
  sendTrigger(input: AgentTriggerInput): Promise<EmitOutcome>;
  /** 订阅 Report 与 Channel 事件;返回退订函数。 */
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /** 拉取工单视图(账本折叠的最新状态;工单 05);失败抛错误消息。 */
  tickets(): Promise<AgentTicketView[]>;
  /** 拉取放权策略(工单 08);失败抛错误消息。 */
  policy(): Promise<AgentPolicy>;
  /** 切换放权模式(工单 08);失败抛错误消息。 */
  setAcceptMode(mode: AcceptMode): Promise<AgentPolicy>;
  /** 拉取评估记录(工单 08);失败抛错误消息。 */
  evals(): Promise<AgentEvalRecord[]>;
}

export function createAgentClient(deps: AgentClientDeps = {}): AgentClient {
  const { baseUrl = "" } = deps;

  return {
    async sendBotChat(input, onEvent) {
      const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
      const response = await doFetch(`${baseUrl}/api/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok || !response.body) throw new Error("小贝暂时连不上。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const event = JSON.parse(line) as BotChatEvent;
            if (event.type === "error") throw new Error(event.text);
            onEvent(event);
            if (event.type === "done") return;
          }
        }
        throw new Error("小贝的回复中断了。");
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    },
    async sendCommand(text) {
      await this.sendTrigger({ source: "pet", kind: "command", data: { text } });
    },

    async sendTrigger(input) {
      const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
      const response = await doFetch(`${baseUrl}/api/agent/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `触发发送失败(HTTP ${response.status})`);
      }
      return (await response.json()) as EmitOutcome;
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

    async policy() {
      const response = await (deps.fetch ?? globalThis.fetch.bind(globalThis))(`${baseUrl}/api/agent/policy`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `放权模式查询失败(HTTP ${response.status})`);
      }
      return (await response.json()) as AgentPolicy;
    },

    async setAcceptMode(mode) {
      const response = await (deps.fetch ?? globalThis.fetch.bind(globalThis))(`${baseUrl}/api/agent/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptMode: mode }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `放权模式切换失败(HTTP ${response.status})`);
      }
      return (await response.json()) as AgentPolicy;
    },

    async evals() {
      const response = await (deps.fetch ?? globalThis.fetch.bind(globalThis))(`${baseUrl}/api/agent/evals`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `评估记录查询失败(HTTP ${response.status})`);
      }
      return (await response.json()) as AgentEvalRecord[];
    },

    onEvent(listener) {
      // jsdom 等无 EventSource 的环境(如 App 级测试)静默不订阅,不阻断渲染。
      const Source = deps.EventSource ?? globalThis.EventSource;
      if (!Source) return () => undefined;
      const source = new Source(`${baseUrl}/api/agent/events`);
      // 服务端事件格式(server/app-server.ts):event: report|channel|delta,
      // data: {report}|{channel}|{delta:{ticketId,text}}(delta 为工单 11 流式对话增量)。
      // 载荷形状从契约 AgentEvent 推导(审查 R11),不另手写一份。
      type SsePayload = {
        report?: Extract<AgentEvent, { type: "report" }>["report"];
        channel?: Extract<AgentEvent, { type: "channel" }>["channel"];
        delta?: Omit<Extract<AgentEvent, { type: "delta" }>, "type">;
      };
      const dispatch = (event: Event): void => {
        let payload: SsePayload;
        try {
          if (!("data" in event) || typeof event.data !== "string") return;
          payload = JSON.parse(event.data) as SsePayload;
        } catch {
          return; // 坏帧丢弃:不让一条脏数据炸掉监听器(审查 R11)
        }
        if (payload.report) listener({ type: "report", report: payload.report });
        if (payload.channel) listener({ type: "channel", channel: payload.channel });
        if (payload.delta) listener({ type: "delta", ...payload.delta });
      };
      source.addEventListener("report", dispatch);
      source.addEventListener("channel", dispatch);
      source.addEventListener("delta", dispatch);
      return () => source.close();
    },
  };
}
