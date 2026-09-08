import type { Conversation, ConversationResult, Material, MaterialDraftPatch, Persona } from "../domain/types";

/**
 * 产品缝:UI 只依赖本接口。
 * - 测试与进程内组合根使用 InProcessProductApi(伪适配器);
 * - 浏览器运行时使用 HttpProductApi(轻量 Node 服务承载真实适配器与存储)。
 */
export interface ProductApi {
  analyzeTranscript(input: { title?: string; transcript: string }): Promise<Material>;
  publishMaterialCards(materialId: string): Promise<Material>;
  publishCards(materialId: string, cardIds: string[]): Promise<Material>;
  updateMaterialDraft(materialId: string, patch: MaterialDraftPatch): Promise<Material>;
  listPersonas(): Promise<Persona[]>;
  startConversation(personaId: string): Promise<Conversation>;
  getConversation(conversationId: string): Promise<Conversation>;
  sendCustomerTurn(conversationId: string, text: string): Promise<Conversation>;
  finishConversation(conversationId: string): Promise<Conversation>;
  getResult(conversationId: string): Promise<ConversationResult>;
}
