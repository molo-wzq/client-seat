import { SEED_PERSONA, SEED_PRODUCT_CARD } from "./seed";
import { randomId } from "./ports";
import { numberTurns, parseTranscriptTurns } from "./transcript";
import type { CopywritingPort, DialoguePort, ProductStorage } from "./ports";
import type {
  Conversation,
  ConversationResult,
  ConversationTurn,
  Material,
  MaterialDraftPatch,
  Persona,
  StrategyCard,
  VisiblePersona,
} from "./types";

/** 每通电话的经理轮数上限(spec.md:提示词规则+应用层轮数上限)。 */
export const MAX_MANAGER_TURNS = 12;

export interface ProductCore {
  analyzeTranscript(input: { title?: string; transcript: string }): Promise<Material>;
  /** 人工确认:把该素材的全部草稿卡发布为已发布。 */
  publishMaterialCards(materialId: string): Promise<Material>;
  /** 人工确认:发布指定策略卡(卡是发布决定的最小单元)。 */
  publishCards(materialId: string, cardIds: string[]): Promise<Material>;
  /** 人工修改素材草稿:纠正说话人、编辑分析、编辑未发布的策略卡。 */
  updateMaterialDraft(materialId: string, patch: MaterialDraftPatch): Promise<Material>;
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

  function findSeedPersona(personaId: string): Persona {
    const persona = [SEED_PERSONA].find((p) => p.id === personaId);
    if (!persona) throw new Error(`画像不存在:${personaId}`);
    return persona;
  }

  /** 构造对话生成可读的画像视图:隐藏信息不离开领域层。 */
  function toVisiblePersona(persona: Persona): VisiblePersona {
    return { id: persona.id, name: persona.name, visible: persona.visible };
  }

  return {
    async analyzeTranscript({ title, transcript }) {
      const text = transcript.trim();
      if (!text) throw new Error("转写稿内容为空");

      const { analysis, cards, turns: adapterTurns } = await copywriting.analyzeTranscript(text);
      // 标题取场景首句,避免长句截断在词中间。
      const materialTitle =
        title?.trim() || analysis.scenario.split(/[。;;,,]/)[0]?.slice(0, 30) || "未命名素材";

      // 说话人区分:适配器结果优先,缺省时按转写解析兜底;两者都允许用户再纠正。
      // 轮次序号保留转写标注(T07)或顺序落号,是策略来源的追溯坐标。
      const turns = numberTurns(
        adapterTurns?.length ? adapterTurns : parseTranscriptTurns(text),
      );

      // 卡 id 必须全局唯一(结果页按 id 追溯):模型给的 id 冲突时重新分配。
      const existingIds = new Set(
        (await storage.listMaterials()).flatMap((m) => m.cards.map((c) => c.id)),
      );
      const material = {
        id: randomId(),
        title: materialTitle,
        transcript: text,
        turns,
        analysis,
        cards: cards.map((card, index) => {
          let id = card.id && !existingIds.has(card.id) ? card.id : "";
          if (!id) {
            id = `${material.id.slice(0, 6)}-sc-${index + 1}`;
            while (existingIds.has(id)) id += "-alt";
          }
          existingIds.add(id);
          return {
            ...card,
            id,
            status: "draft" as const,
            // 卡的来源统一指向所属素材,保证结果页追溯口径一致。
            sourceExcerpt: { ...card.sourceExcerpt, materialTitle },
          };
        }),
        createdAt: new Date().toISOString(),
      } satisfies Material;
      await storage.saveMaterial(material);
      return material;
    },

    async publishMaterialCards(materialId) {
      const material = await requireMaterial(materialId);
      const cardIds = material.cards.filter((c) => c.status === "draft").map((c) => c.id);
      if (cardIds.length === 0) throw new Error("没有可发布的草稿策略卡");
      return this.publishCards(materialId, cardIds);
    },

    async publishCards(materialId, cardIds) {
      const material = await requireMaterial(materialId);
      for (const cardId of cardIds) {
        const card = material.cards.find((c) => c.id === cardId);
        if (!card) throw new Error(`策略卡不存在:${cardId}`);
      }
      material.cards = material.cards.map((c) =>
        cardIds.includes(c.id) ? { ...c, status: "published" as const } : c,
      );
      await storage.saveMaterial(material);
      return material;
    },

    async updateMaterialDraft(materialId, patch) {
      const material = await requireMaterial(materialId);

      if (patch.turns) {
        if (!Array.isArray(patch.turns) || patch.turns.length === 0) {
          throw new Error("轮次数据不合法");
        }
        // 序号必须唯一且为正整数:它是对话结果回溯素材片段的坐标,不重排。
        const seen = new Set<number>();
        for (const turn of patch.turns) {
          if (
            typeof turn.number !== "number" ||
            !Number.isInteger(turn.number) ||
            turn.number < 1 ||
            seen.has(turn.number)
          ) {
            throw new Error(`轮次序号不合法:${JSON.stringify(turn.number)}`);
          }
          seen.add(turn.number);
          if (typeof turn.text !== "string" || !turn.text.trim()) {
            throw new Error("轮次内容不能为空");
          }
        }
        material.turns = patch.turns.map((turn) => ({
          number: turn.number,
          speaker: turn.speaker === "customer" ? ("customer" as const) : ("manager" as const),
          text: turn.text,
        }));
      }

      if (patch.analysis) {
        const { analysis } = patch;
        if (
          typeof analysis !== "object" ||
          analysis === null ||
          typeof analysis.scenario !== "string" ||
          typeof analysis.overallGoal !== "string" ||
          !Array.isArray(analysis.stages)
        ) {
          throw new Error("分析数据不合法");
        }
        material.analysis = analysis;
      }

      if (patch.cards) {
        if (!Array.isArray(patch.cards)) throw new Error("策略卡数据不合法");
        for (const incoming of patch.cards) {
          const current = material.cards.find((c) => c.id === incoming.id);
          if (!current) throw new Error(`策略卡不存在:${incoming.id}`);
          if (current.status === "published") {
            throw new Error(`策略卡已发布,不可修改:${current.name}`);
          }
        }
        material.cards = material.cards.map((card) => {
          const incoming = patch.cards?.find((c) => c.id === card.id);
          return incoming ? { ...card, ...incoming, status: "draft" as const } : card;
        });
      }

      await storage.saveMaterial(material);
      return material;
    },

    async listPersonas() {
      // 种子画像;issue 03 扩展自定义画像时在此并入存储的画像。
      return [SEED_PERSONA];
    },

    async startConversation(personaId) {
      const persona = findSeedPersona(personaId);
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

      const persona = toVisiblePersona(findSeedPersona(conversation.personaId));

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
      // 结果追溯只承认已发布卡:草稿卡本就不该进入对话。
      const cardsById = new Map<string, StrategyCard>();
      for (const material of materials) {
        for (const card of material.cards) {
          if (card.status === "published") cardsById.set(card.id, card);
        }
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
          .filter((t) => t.usedCardId && cardsById.has(t.usedCardId))
          .map((t) => {
            const card = cardsById.get(t.usedCardId as string);
            return {
              turnNumber: t.number,
              cardId: t.usedCardId as string,
              cardName: card!.name,
              keyExpression: t.text,
              source: card!.sourceExcerpt ?? null,
            };
          }),
      };
    },
  };
}

