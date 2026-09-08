import { SEED_PERSONA, SEED_PRODUCT_CARD } from "./seed";
import { randomId } from "./ports";
import type { CopywritingPort, DialoguePort, ProductStorage } from "./ports";
import type {
  Conversation,
  ConversationResult,
  ConversationTurn,
  Material,
  Persona,
  StrategyCard,
} from "./types";

/** 每通电话的经理轮数上限(spec.md:提示词规则+应用层轮数上限)。 */
export const MAX_MANAGER_TURNS = 12;

export interface ProductCore {
  analyzeTranscript(input: { title?: string; transcript: string }): Promise<Material>;
  /** 人工确认:把该素材的全部草稿卡发布为已发布。 */
  publishMaterialCards(materialId: string): Promise<Material>;
  listPersonas(): Promise<Persona[]>;
  startConversation(personaId: string): Promise<Conversation>;
  getConversation(conversationId: string): Promise<Conversation>;
  sendCustomerTurn(conversationId: string, text: string): Promise<Conversation>;
  finishConversation(conversationId: string): Promise<Conversation>;
  getResult(conversationId: string): Promise<ConversationResult>;
}

export function createProductCore(deps: {
  copywriting: CopywritingPort;
  dialogue: DialoguePort;
  storage: ProductStorage;
}): ProductCore {
  const { copywriting, dialogue, storage } = deps;

  async function requireMaterial(materialId: string): Promise<Material> {
    const material = await storage.getMaterial(materialId);
    if (!material) throw new Error(`素材不存在:${materialId}`);
    return material;
  }

  async function requireConversation(conversationId: string): Promise<Conversation> {
    const conversation = await storage.getConversation(conversationId);
    if (!conversation) throw new Error(`通话不存在:${conversationId}`);
    return conversation;
  }

  async function listPublishedCards(): Promise<StrategyCard[]> {
    const materials = await storage.listMaterials();
    return materials.flatMap((m) => m.cards.filter((c) => c.status === "published"));
  }

  return {
    async analyzeTranscript({ title, transcript }) {
      const text = transcript.trim();
      if (!text) throw new Error("转写稿内容为空");

      const { analysis, cards } = await copywriting.analyzeTranscript(text);
      // 标题取场景首句,避免长句截断在词中间。
      const materialTitle =
        title?.trim() || analysis.scenario.split(/[。;;,,]/)[0]?.slice(0, 30) || "未命名素材";
      const material: Material = {
        id: randomId(),
        title: materialTitle,
        transcript: text,
        analysis,
        cards: cards.map((card, index) => ({
          ...card,
          id: card.id || `sc-${index + 1}`,
          status: "draft" as const,
          // 卡的来源统一指向所属素材,保证结果页追溯口径一致。
          sourceExcerpt: { ...card.sourceExcerpt, materialTitle },
        })),
        createdAt: new Date().toISOString(),
      };
      await storage.saveMaterial(material);
      return material;
    },

    async publishMaterialCards(materialId) {
      const material = await requireMaterial(materialId);
      const draftCount = material.cards.filter((c) => c.status === "draft").length;
      if (draftCount === 0) throw new Error("没有可发布的草稿策略卡");
      material.cards = material.cards.map((c) => ({ ...c, status: "published" as const }));
      await storage.saveMaterial(material);
      return material;
    },

    async listPersonas() {
      // 种子画像;issue 03 扩展自定义画像时在此并入存储的画像。
      return [SEED_PERSONA];
    },

    async startConversation(personaId) {
      const persona = [SEED_PERSONA].find((p) => p.id === personaId);
      if (!persona) throw new Error(`画像不存在:${personaId}`);
      const conversation: Conversation = {
        id: randomId(),
        personaId,
        status: "ongoing",
        turns: [],
        createdAt: new Date().toISOString(),
      };
      await storage.saveConversation(conversation);
      return conversation;
    },

    async getConversation(conversationId) {
      return requireConversation(conversationId);
    },

    async sendCustomerTurn(conversationId, text) {
      const conversation = await requireConversation(conversationId);
      if (conversation.status === "ended") throw new Error("通话已结束");
      const customerText = text.trim();
      if (!customerText) throw new Error("客户发言为空");

      const persona = [SEED_PERSONA].find((p) => p.id === conversation.personaId);
      if (!persona) throw new Error(`画像不存在:${conversation.personaId}`);

      const history = conversation.turns;
      const output = await dialogue.generateManagerTurn({
        persona,
        publishedCards: await listPublishedCards(),
        product: SEED_PRODUCT_CARD,
        history,
        customerText,
      });

      const nextNumber = conversation.turns.length + 1;
      const customerTurn: ConversationTurn = {
        number: nextNumber,
        speaker: "customer",
        text: customerText,
      };
      const managerTurn: ConversationTurn = {
        number: nextNumber + 1,
        speaker: "manager",
        text: output.reply,
        usedCardId: output.usedCardId,
        recognizedSignal: output.recognizedSignal,
        currentGoal: output.currentGoal,
      };
      conversation.turns = [...conversation.turns, customerTurn, managerTurn];

      const managerTurnCount = conversation.turns.filter((t) => t.speaker === "manager").length;
      if (output.shouldEnd) {
        conversation.status = "ended";
        conversation.endReason = output.endReason || "通话结束";
        conversation.outcomeSummary = output.outcomeSummary || "未知";
      } else if (managerTurnCount >= MAX_MANAGER_TURNS) {
        conversation.status = "ended";
        conversation.endReason = "达到轮数上限,理财经理体面收口";
        conversation.outcomeSummary = "未知";
      }
      await storage.saveConversation(conversation);
      return conversation;
    },

    async finishConversation(conversationId) {
      const conversation = await requireConversation(conversationId);
      if (conversation.status === "ended") return conversation;
      conversation.status = "ended";
      conversation.endReason = "客户主动结束通话";
      conversation.outcomeSummary = conversation.outcomeSummary || "未知";
      await storage.saveConversation(conversation);
      return conversation;
    },

    async getResult(conversationId) {
      const conversation = await requireConversation(conversationId);
      if (conversation.status !== "ended") throw new Error("通话尚未结束,无法生成结果");

      const materials = await storage.listMaterials();
      const cardsById = new Map<string, StrategyCard>();
      for (const material of materials) {
        for (const card of material.cards) cardsById.set(card.id, card);
      }

      const managerTurns = conversation.turns.filter((t) => t.speaker === "manager");
      const goals = managerTurns
        .map((t) => t.currentGoal)
        .filter((g): g is string => Boolean(g && g !== "未知" && g !== "无"));

      return {
        conversationId: conversation.id,
        mainGoal: goals.length > 0 ? goals[goals.length - 1] : "未知",
        outcome: conversation.outcomeSummary || "未知",
        endReason: conversation.endReason || "未知",
        turns: conversation.turns,
        strategyPath: managerTurns
          .filter((t) => t.usedCardId)
          .map((t) => {
            const card = cardsById.get(t.usedCardId as string);
            return {
              turnNumber: t.number,
              cardId: t.usedCardId as string,
              cardName: card?.name || "未知策略卡",
              keyExpression: t.text,
              source: card?.sourceExcerpt ?? null,
            };
          }),
      };
    },
  };
}

