import type { Conversation } from "../domain/types";
import type { ProductCore } from "../domain/product-core";

/**
 * 浏览器端适配器:UI 只依赖领域侧唯一接口 ProductCore(声明在 domain/product-core.ts)。
 * 本文件以 http 传输满足该接口,真实服务在 server/(组合根 createProductCore + FileStorage);
 * 测试与进程内路径用 in-process-product-api.ts 的同类适配器。
 */

/** 逐块解析 SSE 事件流,按事件名分发;resolve 于 done,拒绝于 error/流意外中断。 */
async function consumeTurnStream(
  body: ReadableStream<Uint8Array>,
  onReplyDelta: (delta: string) => void,
): Promise<Conversation> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error("流式连接在完成前中断");
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const lines = event.split("\n");
      const eventName = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (eventName === "delta") {
        const delta = JSON.parse(payload) as { text?: string };
        if (delta.text) onReplyDelta(delta.text);
      } else if (eventName === "done") {
        return JSON.parse(payload) as Conversation;
      } else if (eventName === "error") {
        const err = JSON.parse(payload) as { error?: string };
        throw new Error(err.error || "流式接口错误");
      }
    }
  }
}

export function createHttpProductCore(baseUrl = ""): ProductCore {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `请求失败(HTTP ${response.status})`;
      throw new Error(message);
    }
    // 2xx 但解析不出 JSON(空 body/被网关改写):静默返回 null 会让上层
    // 以 null 数据渲染崩溃,这里显式报错走统一的错误展示。
    if (body === null || typeof body !== "object") {
      throw new Error(`接口响应不是合法 JSON(HTTP ${response.status}:${path})`);
    }
    return body as T;
  }

  /**
   * 流式轮次(票 29):POST /turns/stream 解析 SSE——delta 增量回调,
   * done 携带权威会话 resolve,error 事件与非 2xx 都走统一 Error。
   */
  async function requestTurnStream(
    conversationId: string,
    text: string,
    onReplyDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<Conversation> {
    const response = await fetch(
      `${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/turns/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(body?.error ? String(body.error) : `请求失败(HTTP ${response.status})`);
    }
    if (!response.body) throw new Error("流式接口未返回响应体");
    return consumeTurnStream(response.body, onReplyDelta);
  }

  return {
    analyzeTranscript: (input) =>
      request("/materials/analyze", { method: "POST", body: JSON.stringify(input) }),
    publishMaterialCards: (materialId) =>
      request(`/materials/${encodeURIComponent(materialId)}/publish`, { method: "POST" }),
    publishCards: (materialId, cardIds) =>
      request(`/materials/${encodeURIComponent(materialId)}/publish`, {
        method: "POST",
        body: JSON.stringify({ cardIds }),
      }),
    updateMaterialDraft: (materialId, patch) =>
      request(`/materials/${encodeURIComponent(materialId)}/draft`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    listMaterials: () => request("/materials"),
    getMaterial: (materialId) => request(`/materials/${encodeURIComponent(materialId)}`),
    listPersonas: () => request("/personas"),
    savePersona: (input) =>
      request("/personas", { method: "POST", body: JSON.stringify(input) }),
    startConversation: (personaId) =>
      request("/conversations", { method: "POST", body: JSON.stringify({ personaId }) }),
    quickStart: () => request("/quickstart", { method: "POST" }),
    getConversation: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}`),
    listConversations: () => request("/conversations"),
    sendCustomerTurn: (conversationId, text) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/turns`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    sendCustomerTurnStream: (conversationId, text, onReplyDelta, signal) =>
      requestTurnStream(conversationId, text, onReplyDelta, signal),
    regenerateManagerTurn: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/regenerate`, {
        method: "POST",
      }),
    finishConversation: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/finish`, { method: "POST" }),
    getResult: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/result`),
  };
}
