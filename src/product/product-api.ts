import type {
  Conversation,
  ConversationResult,
  Material,
  MaterialDraftPatch,
  MaterialKind,
  Persona,
  PersonaInput,
} from "../domain/types";

/**
 * 产品缝:UI 只依赖本接口。
 * - 测试与进程内组合根使用 InProcessProductApi(伪适配器);
 * - 浏览器运行时使用 HttpProductApi(轻量 Node 服务承载真实适配器与存储)。
 */
export interface ProductApi {
  analyzeTranscript(input: { title?: string; transcript: string; kind?: MaterialKind }): Promise<Material>;
  publishMaterialCards(materialId: string): Promise<Material>;
  publishCards(materialId: string, cardIds: string[]): Promise<Material>;
  updateMaterialDraft(materialId: string, patch: MaterialDraftPatch): Promise<Material>;
  listMaterials(): Promise<Material[]>;
  getMaterial(materialId: string): Promise<Material>;
  savePersona(input: PersonaInput): Promise<Persona>;
  listPersonas(): Promise<Persona[]>;
  startConversation(personaId: string): Promise<Conversation>;
  /** 快速开始:跳过素材流程,用内置画像与已发布策略卡(空库时种子兜底)直接开一通对话。 */
  quickStart(): Promise<Conversation>;
  getConversation(conversationId: string): Promise<Conversation>;
  listConversations(): Promise<Conversation[]>;
  sendCustomerTurn(conversationId: string, text: string): Promise<Conversation>;
  finishConversation(conversationId: string): Promise<Conversation>;
  getResult(conversationId: string): Promise<ConversationResult>;
}
