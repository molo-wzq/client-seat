import type { ProductApi } from "./product-api";

/** 浏览器端实现:调用轻量 Node 服务(见 server/)。 */
export function createHttpProductApi(baseUrl = ""): ProductApi {
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
    return body as T;
  }

  return {
    analyzeTranscript: (input) =>
      request("/materials/analyze", { method: "POST", body: JSON.stringify(input) }),
    publishMaterialCards: (materialId) =>
      request(`/materials/${encodeURIComponent(materialId)}/publish`, { method: "POST" }),
    listPersonas: () => request("/personas"),
    startConversation: (personaId) =>
      request("/conversations", { method: "POST", body: JSON.stringify({ personaId }) }),
    getConversation: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}`),
    sendCustomerTurn: (conversationId, text) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/turns`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    finishConversation: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/finish`, { method: "POST" }),
    getResult: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/result`),
  };
}
