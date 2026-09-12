import type { ProductCore } from "../domain/product-core";

/**
 * 浏览器端适配器:UI 只依赖领域侧唯一接口 ProductCore(声明在 domain/product-core.ts)。
 * 本文件以 http 传输满足该接口,真实服务在 server/(组合根 createProductCore + FileStorage);
 * 测试与进程内路径用 in-process-product-api.ts 的同类适配器。
 */
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
    finishConversation: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/finish`, { method: "POST" }),
    getResult: (conversationId) =>
      request(`/conversations/${encodeURIComponent(conversationId)}/result`),
  };
}
