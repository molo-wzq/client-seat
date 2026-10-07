import { buildSeedMaterial, SEED_MATERIAL_ID, SEED_MATERIAL_TITLE, SEED_PERSONAS, SEED_PRODUCT_CARD } from "./seed";
import { randomId } from "./ports";
import {
  compareConversationsByRecency,
  NO_RETENTION,
  purgeExpiredConversations,
  type ConversationRetentionPolicy,
} from "./conversation-retention";
import { numberTurns, parseTranscriptTurns, resolveTurnRange } from "./transcript";
import { PROMPT_VERSION } from "./prompt-version";
import { detectManagerFarewell } from "./reply-text";
import { hasOutOfCardNumber, factRelationNotes } from "./product-facts";
import { customerIntent } from "./customer-intent";
import type { CopywritingPort, DialoguePort, ProductStorage, ManagerTurnOutput } from "./ports";
import type {
  Conversation,
  ConversationStartOptions,
  ConversationResult,
  ConversationTurn,
  Material,
  MaterialDraftPatch,
  MaterialKind,
  Persona,
  PersonaInput,
  StrategyCard,
  ConversationResources,
  PlayerObservation,
  VisiblePersona,
} from "./types";
import { isMaterialKind, isFeelingStamp } from "./types";

/** 每通电话的经理轮数上限(spec.md:提示词规则+应用层轮数上限)。 */
export const MAX_MANAGER_TURNS = 12;

/** 领域错误:请求的资源不存在,server 层映射为 404。 */
export class NotFoundError extends Error {}

/** 领域错误:输入不合法(如素材类型归档错误),server 层映射为 400。 */
export class ValidationError extends Error {}

export interface ProductCore {
  analyzeTranscript(input: { title?: string; transcript: string; kind?: MaterialKind }): Promise<Material>;
  /** 人工确认:把该素材的全部草稿卡发布为已发布。 */
  publishMaterialCards(materialId: string): Promise<Material>;
  /** 人工确认:发布指定策略卡(卡是发布决定的最小单元)。 */
  publishCards(materialId: string, cardIds: string[]): Promise<Material>;
  /** 人工修改素材草稿:纠正说话人、编辑分析、编辑未发布的策略卡。 */
  updateMaterialDraft(materialId: string, patch: MaterialDraftPatch): Promise<Material>;
  listMaterials(): Promise<Material[]>;
  getMaterial(materialId: string): Promise<Material>;
  /** 从预设或修改后的属性保存一位自定义生客;留空字段保持未知,不自动补全。 */
  savePersona(input: PersonaInput): Promise<Persona>;
  listPersonas(): Promise<Persona[]>;
  startConversation(personaId: string, options?: ConversationStartOptions): Promise<Conversation>;
  /** 快速开始:库中无已发布策略卡时以种子素材(已发布态)兜底,用第一个内置画像直接开一通对话;幂等。 */
  quickStart(): Promise<Conversation>;
  getConversation(conversationId: string): Promise<Conversation>;
  listConversations(): Promise<Conversation[]>;
  sendCustomerTurn(conversationId: string, text: string): Promise<Conversation>;
  /**
   * 流式变体(票 29):话术增量经 onReplyDelta 逐段上屏,
   * 返回值与 sendCustomerTurn 相同(完整会话,含元数据与结束状态)。
   */
  sendCustomerTurnStream(
    conversationId: string,
    text: string,
    onReplyDelta: (delta: string) => void,
    /** 中止信号(停止生成):客户端断流用;服务端生成是否随之取消由实现决定。 */
    signal?: AbortSignal,
  ): Promise<Conversation>;
  /**
   * 重新生成经理回复:保留原经理轮版本，以同一客户发言重试。
   * 不追加新的客户轮;最后一轮不是经理话术或通话已结束时报错。
   */
  regenerateManagerTurn(conversationId: string): Promise<Conversation>;
  branchConversation(conversationId: string, customerTurnNumber: number, replacementText: string): Promise<Conversation>;
  saveObservation(conversationId: string, observation: PlayerObservation): Promise<Conversation>;
  finishConversation(conversationId: string): Promise<Conversation>;
  getResult(conversationId: string): Promise<ConversationResult>;
}

export function createProductCore(deps: {
  copywriting: CopywritingPort;
  dialogue: DialoguePort;
  storage: ProductStorage;
  /** 对话存储上限(最大存储时间/条数);缺省不限制,保持既有行为。 */
  retention?: ConversationRetentionPolicy;
  /** 时钟注入:保留策略与 createdAt 共用同一时间源,测试可固定。 */
  now?: () => Date;
}): ProductCore {
  const { copywriting, dialogue, storage } = deps;
  const retention = deps.retention ?? NO_RETENTION;
  const now = deps.now ?? (() => new Date());

  /**
   * 按实体 id 串行化读-改-写:await 模型调用可达数秒,期间同一实体的并发
   * 请求若都基于旧快照整体覆盖写,先到的更新会被静默丢弃(丢轮次/丢编辑)。
   * 前序任务失败不阻塞后续任务。
   */
  const tails = new Map<string, Promise<unknown>>();
  function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  }

  async function requireMaterial(materialId: string): Promise<Material> {
    const material = await storage.getMaterial(materialId);
    if (!material) throw new NotFoundError(`素材不存在:${materialId}`);
    return material;
  }

  async function requireConversation(conversationId: string): Promise<Conversation> {
    const conversation = await storage.getConversation(conversationId);
    if (!conversation) throw new NotFoundError(`通话不存在:${conversationId}`);
    return conversation;
  }

  async function listPublishedCards(): Promise<StrategyCard[]> {
    const materials = await storage.listMaterials();
    return materials.flatMap((m) => m.cards.filter((c) => c.status === "published"));
  }

  function locateSourceMaterial(source: StrategyCard["sourceExcerpt"], materials: Material[]) {
    if (source.materialId) return materials.find((material) => material.id === source.materialId);
    // 旧来源只记录标题时,重名无法可靠定位,不能随意引用第一份素材。
    const matches = materials.filter((material) => material.title === source.materialTitle);
    return matches.length === 1 ? matches[0] : undefined;
  }

  async function listAllPersonas(): Promise<Persona[]> {
    // 内置 3 画像在前(P01–P03,提取自真实素材),自定义画像按保存顺序并入。
    return [...SEED_PERSONAS, ...(await storage.listPersonas())];
  }

  async function requirePersona(personaId: string): Promise<Persona> {
    const persona = (await listAllPersonas()).find((p) => p.id === personaId);
    if (!persona) throw new NotFoundError(`画像不存在:${personaId}`);
    return persona;
  }

  /** 构造对话生成可读的画像视图:隐藏信息不离开领域层。 */
  function toVisiblePersona(persona: Persona): VisiblePersona {
    return { id: persona.id, name: persona.name, visible: persona.visible };
  }

  async function snapshotResources(personaId: string): Promise<ConversationResources> {
    const materials = await storage.listMaterials();
    const cards = materials.flatMap((material) => material.cards.filter((card) => card.status === 'published'));
    return structuredClone({
      persona: await requirePersona(personaId), cards,
      evidence: cards.map((card) => ({
        cardId: card.id, cardName: card.name, source: card.sourceExcerpt,
        sourceTurns: resolveTurnRange(card.sourceExcerpt.turnRange, locateSourceMaterial(card.sourceExcerpt, materials)?.turns ?? []),
      })),
    });
  }

  function observedOutcome(conversation: Conversation): string {
    const count = conversation.turns.filter((turn) => turn.speaker === 'manager').length;
    return count ? `已记录 ${count} 轮经理回应；未记录已确认的下一步承诺。可按原话继续核对。` : '客户在经理回应前结束；没有形成下一步承诺。';
  }

  /**
   * 卡 id 必须全局唯一(结果页按 id 追溯):与库内冲突的 id 重新分配。
   * analyzeTranscript 与 quickStart 的种子入库共用同一规则。
   */
  function allocateCardIds(
    materialId: string,
    cards: Array<Omit<StrategyCard, "status">>,
    libraryIds?: Set<string>,
  ): string[] {
    const existingIds = libraryIds ?? new Set<string>();
    return cards.map((card, index) => {
      let id = card.id && !existingIds.has(card.id) ? card.id : "";
      if (!id) {
        id = `${materialId.slice(0, 6)}-sc-${index + 1}`;
        while (existingIds.has(id)) id += "-alt";
      }
      existingIds.add(id);
      return id;
    });
  }

  async function collectCardIds(): Promise<Set<string>> {
    return new Set((await storage.listMaterials()).flatMap((m) => m.cards.map((c) => c.id)));
  }

  async function publishCardsLocked(materialId: string, cardIds: string[]): Promise<Material> {
    const material = await requireMaterial(materialId);
    for (const cardId of cardIds) {
      const card = material.cards.find((c) => c.id === cardId);
      if (!card) throw new NotFoundError(`策略卡不存在:${cardId}`);
    }
    material.cards = material.cards.map((c) =>
      cardIds.includes(c.id) ? { ...c, status: "published" as const } : c,
    );
    await storage.saveMaterial(material);
    return material;
  }

  async function startConversationLocked(personaId: string, options: ConversationStartOptions = {}): Promise<Conversation> {
    if (options.observationFocus !== undefined && !["signals", "conditions", "next-step", "free"].includes(options.observationFocus)) {
      throw new ValidationError("观察点不合法");
    }
    if (options.replayOfId !== undefined && (typeof options.replayOfId !== "string" || !options.replayOfId.trim())) {
      throw new ValidationError("原局标识不合法");
    }
    const original = options.replayOfId ? await requireConversation(options.replayOfId) : undefined;
    if (original && (original.status !== "ended" || original.personaId !== personaId)) {
      throw new ValidationError("只能重试同一客户已结束的通话");
    }
    const resources = original?.resources ? structuredClone(original.resources) : await snapshotResources(personaId);
    const conversation: Conversation = {
      id: randomId(),
      revision: 0,
      personaId,
      observationFocus: options.observationFocus ?? original?.observationFocus ?? "signals",
      productFacts: structuredClone(original?.productFacts ?? SEED_PRODUCT_CARD),
      resources,
      openingGoal: '确认沟通意愿，了解必要需求，在客户同意后争取适合的下一步',
      ...(original ? { replayOfId: original.id } : {}),
      status: "ongoing",
      turns: [],
      createdAt: now().toISOString(),
      // 复盘追溯:记录本局按哪版提示词打的;旧记录无此字段,如实视为未记录。
      promptVersion: PROMPT_VERSION,
    };
    await storage.saveConversation(conversation);
    // 存储上限在开新通话的落库点执行:所有新对话入口都过这里,不依赖 UI/HTTP 层。
    // 刚保存的这通是最新记录,不会被两条规则命中。
    await purgeExpiredConversations(storage, now(), retention);
    return conversation;
  }

  /**
   * 通话轮次生成(票 29 抽出、票 31 复用):普通/流式/重新生成共用同一落库路径。
   * 前置条件:conversation.turns 以客户轮结尾,经理轮追加在其后。
   */
  function sendCustomerTurnStreaming(
    conversationId: string,
    text: string,
    onReplyDelta?: (delta: string) => void,
  ): Promise<Conversation> {
    // 串行化同一通话的读-改-写:双击发送/重试/多标签页并发时,
    // 两个请求基于同一旧快照生成相同轮次号,后写覆盖先写会静默丢轮次。
    return serialize(`conversation:${conversationId}`, async () => {
      const conversation = await requireConversation(conversationId);
      if (conversation.status === "ended") throw new Error("通话已结束");
      const customerText = text.trim();
      if (!customerText) throw new Error("客户发言为空");

      const customerTurn: ConversationTurn = {
        number: conversation.turns.length + 1,
        speaker: "customer",
        text: customerText,
      };
      conversation.turns = [...conversation.turns, customerTurn];
      return appendManagerTurn(conversation, onReplyDelta);
    });
  }

  /** 以最后一轮客户发言为输入生成经理轮,追加、判收口、落库。 */
  async function appendManagerTurn(
    conversation: Conversation,
    onReplyDelta?: (delta: string) => void,
  ): Promise<Conversation> {
    const customerTurn = conversation.turns.at(-1);
    if (!customerTurn || customerTurn.speaker !== "customer") {
      throw new Error("最后一轮不是客户发言,无法生成经理回复");
    }

    const persona = toVisiblePersona(conversation.resources?.persona ?? await requirePersona(conversation.personaId));
    const productFacts = conversation.productFacts ?? SEED_PRODUCT_CARD;
    // 用卡与来源从同一份本轮库快照读取,避免生成期间编辑造成证据错位。
    const turnMaterials = conversation.resources ? [] : await storage.listMaterials();
    const publishedCards = conversation.resources?.cards ?? turnMaterials.flatMap((m) => m.cards.filter((c) => c.status === "published"));
    const leaving = customerIntent(customerTurn.text) === 'leave';
    // 明确离场是客户的选择，模型故障或错误归因不能让客户被迫继续。
    const output: ManagerTurnOutput = leaving ? {
      reply: '好的，先不打扰您了。有需要可以通过银行官方渠道联系我们，再见。',
      recognizedSignal: '客户明确表示结束当前通话', currentGoal: '尊重离场意图，体面收口',
      shouldEnd: true, endReason: '客户明确离场，通话结束', outcomeSummary: '客户明确结束通话；没有据此新增报名或联系授权。',
    } : await dialogue.generateManagerTurn(
      {
        persona,
        publishedCards: structuredClone(publishedCards),
        product: productFacts,
        history: conversation.turns.slice(0, -1).map(({ strategyEvidence: _privateEvidence, promptVersion: _version, factCheckNotes: _factNotes, managerReasoning: _reasoning, ...turn }) => turn),
        customerText: customerTurn.text,
      },
      onReplyDelta,
    );
    if (leaving) onReplyDelta?.(output.reply);

    // 模型声称使用的卡必须是本轮检索到的已发布卡:检索边界落到数据上。
    // 匹配依据只在用卡可信时保留:无卡或卡不在候选集,依据一并丢弃,不伪造。
    const usedCard = publishedCards.find((c) => c.id === output.usedCardId);
    const retrievable = Boolean(usedCard && output.cardMatchBasis?.trim());
    const sourceMaterial = usedCard && locateSourceMaterial(usedCard.sourceExcerpt, turnMaterials);
    // 卡外数字守卫：只认产品事实与客户口述，经理重复不能洗白数字。
    // 只标不拦,与策略卡「未确认」同一哲学——复盘如实呈现,不改话术。
    const outOfCardFact = hasOutOfCardNumber(
      output.reply,
      productFacts,
      conversation.turns,
    );
    const factCheckNotes = [...new Set([...(output.factCheckNotes ?? []), ...factRelationNotes(output.reply, productFacts)])];
    const managerTurn: ConversationTurn = {
      number: customerTurn.number + 1,
      speaker: "manager",
      promptVersion: PROMPT_VERSION,
      text: output.reply,
      usedCardId: retrievable ? output.usedCardId : undefined,
      ...(retrievable && usedCard ? { strategyEvidence: conversation.resources?.evidence.find((item) => item.cardId === usedCard.id) ?? {
        cardId: usedCard.id,
        cardName: usedCard.name,
        source: structuredClone(usedCard.sourceExcerpt),
        sourceTurns: sourceMaterial ? structuredClone(resolveTurnRange(usedCard.sourceExcerpt.turnRange, sourceMaterial.turns)) : [],
      } } : {}),
      recognizedSignal: output.recognizedSignal,
      currentGoal: output.currentGoal,
      ...(retrievable && output.cardMatchBasis ? { cardMatchBasis: output.cardMatchBasis } : {}),
      ...(output.logicHint ? { logicHint: output.logicHint } : {}),
      ...(output.reasoning ? { managerReasoning: output.reasoning } : {}),
      ...(factCheckNotes.length ? { factCheckNotes } : {}),
      ...(outOfCardFact ? { outOfCardFact: true } : {}),
    };
    conversation.turns = [...conversation.turns, managerTurn];

    const managerTurnCount = conversation.turns.filter((t) => t.speaker === "manager").length;
    // 告别收口兜底(已知规则的确定性检查):元数据缺失或判 false,但话术
    // 最后一句已是明确告别——电话里经理说了再见,通话就结束了,不能停在
    // "进行中"等用户再发言。只结束通话状态,不伪造用卡或结果摘要。
    const farewellOnly = output.shouldEnd !== true && detectManagerFarewell(output.reply);
    if (output.shouldEnd || farewellOnly) {
      conversation.status = "ended";
      conversation.endReason =
        output.endReason || (farewellOnly ? "理财经理已告别收口,通话结束" : "通话结束");
      conversation.outcomeSummary = output.outcomeSummary || observedOutcome(conversation);
    } else if (managerTurnCount >= MAX_MANAGER_TURNS) {
      conversation.status = "ended";
      conversation.endReason = "达到轮数上限,本局通话结束";
      conversation.outcomeSummary = observedOutcome(conversation);
    }
    conversation.revision = (conversation.revision ?? 0) + 1;
    await storage.saveConversation(conversation);
    return conversation;
  }

  return {
    async analyzeTranscript({ title, transcript, kind }) {
      const text = transcript.trim();
      if (!text) throw new Error("转写稿内容为空");
      if (kind !== undefined && !isMaterialKind(kind)) throw new ValidationError("素材类型不合法");

      const { analysis, cards, turns: adapterTurns } = await copywriting.analyzeTranscript(text);
      // 标题取场景首句,避免长句截断在词中间。
      const materialTitle =
        title?.trim() || analysis.scenario.split(/[。；;，,、]/)[0]?.slice(0, 30) || "未命名素材";

      // 说话人区分:适配器结果优先,缺省时按转写解析兜底;两者都允许用户再纠正。
      // 轮次序号保留转写标注(T07)或顺序落号,是策略来源的追溯坐标。
      const turns = numberTurns(
        adapterTurns?.length ? adapterTurns : parseTranscriptTurns(text),
      );

      const materialId = randomId();
      const cardIds = allocateCardIds(materialId, cards, await collectCardIds());
      const material = {
        id: materialId,
        title: materialTitle,
        transcript: text,
        turns,
        analysis,
        cards: cards.map((card, index) => ({
          ...card,
          id: cardIds[index] as string,
          status: "draft" as const,
          // 来源指向所属素材(id 定位,标题供人读),保证结果页追溯口径一致。
          sourceExcerpt: { ...card.sourceExcerpt, materialTitle, materialId },
        })),
        createdAt: new Date().toISOString(),
        ...(kind ? { kind } : {}),
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
      return serialize(`material:${materialId}`, () => publishCardsLocked(materialId, cardIds));
    },

    async updateMaterialDraft(materialId, patch) {
      return serialize(`material:${materialId}`, async () => {
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
            // 说话人只认 manager/customer:拼写错误静默纠偏会把经理话当客户话入库。
            if (turn.speaker !== "manager" && turn.speaker !== "customer") {
              throw new Error(`轮次说话人不合法:${JSON.stringify(turn.speaker)}`);
            }
          }
          material.turns = patch.turns.map((turn) => ({
            number: turn.number,
            speaker: turn.speaker,
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
            if (!current) throw new NotFoundError(`策略卡不存在:${incoming.id}`);
            if (current.status === "published") {
              throw new Error(`策略卡已发布,不可修改:${current.name}`);
            }
          }
          material.cards = material.cards.map((card) => {
            const incoming = patch.cards?.find((c) => c.id === card.id);
            return incoming ? { ...card, ...incoming, status: "draft" as const } : card;
          });
        }

        if (patch.kind !== undefined) {
          if (!isMaterialKind(patch.kind)) throw new ValidationError("素材类型不合法");
          material.kind = patch.kind;
        }

        await storage.saveMaterial(material);
        return material;
      });
    },

    async listMaterials() {
      return storage.listMaterials();
    },

    async getMaterial(materialId) {
      return requireMaterial(materialId);
    },

    async listPersonas() {
      // 预设画像在前,自定义画像按保存顺序并入;新增预设只改种子数据。
      return listAllPersonas();
    },

    async savePersona(input) {
      const persona: Persona = {
        id: randomId(),
        name: input.name.trim() || "自定义生客",
        // 只做去空格与去空行;不存在的属性保持未知,不自动补全。
        visible: input.visible.map((line) => line.trim()).filter(Boolean),
        hidden: input.hidden.map((line) => line.trim()).filter(Boolean),
      };
      await storage.savePersona(persona);
      return persona;
    },

    async startConversation(personaId, options) {
      return startConversationLocked(personaId, options);
    },

    async getConversation(conversationId) {
      // 断流/切幕后恢复须等待当前轮落库，不能把正在生成前的旧快照当作权威记录。
      return serialize(`conversation:${conversationId}`, () => requireConversation(conversationId));
    },

    async listConversations() {
      const conversations = await storage.listConversations();
      // 创建时间倒序(比较器与保留策略共享单一定义),排序稳定。
      return [...conversations].sort(compareConversationsByRecency);
    },

    async quickStart() {
      return serialize("quickstart", async () => {
        if ((await listPublishedCards()).length === 0) {
          // 按 id 优先、标题兜底(旧数据)定位已入库的种子素材。
          const existing =
            (await storage.getMaterial(SEED_MATERIAL_ID)) ??
            (await storage.listMaterials()).find((m) => m.title === SEED_MATERIAL_TITLE);
          if (existing) {
            // 种子素材已在库但卡未发布:直接发布其草稿卡。
            const draftIds = existing.cards.filter((c) => c.status === "draft").map((c) => c.id);
            if (draftIds.length > 0) await publishCardsLocked(existing.id, draftIds);
          } else {
            // 卡 id 与库内去重(与 analyzeTranscript 同规则):
            // 分析其他素材可能已占用 sc-c01-* 固定 id,直接插入会产生跨素材重复 id。
            const seed = buildSeedMaterial();
            const materialId = SEED_MATERIAL_ID;
            const cardIds = allocateCardIds(materialId, seed.cards, await collectCardIds());
            await storage.saveMaterial({
              ...seed,
              id: materialId,
              createdAt: new Date().toISOString(),
              cards: seed.cards.map((card, index) => ({
                ...card,
                id: cardIds[index] as string,
                status: "published" as const,
                sourceExcerpt: { ...card.sourceExcerpt, materialId },
              })),
            });
          }
        }
        const persona = SEED_PERSONAS[0];
        if (!persona) throw new Error("缺少内置画像,无法快速开始");
        return startConversationLocked(persona.id);
      });
    },

    async sendCustomerTurn(conversationId, text) {
      return sendCustomerTurnStreaming(conversationId, text);
    },

    async sendCustomerTurnStream(conversationId, text, onReplyDelta) {
      // signal 仅浏览器端断流用;进程内路径无传输可断,忽略。
      return sendCustomerTurnStreaming(conversationId, text, onReplyDelta);
    },

    async regenerateManagerTurn(conversationId) {
      return serialize(`conversation:${conversationId}`, async () => {
        const conversation = await requireConversation(conversationId);
        if (conversation.status === "ended") throw new Error("通话已结束,无法重新生成");
        const last = conversation.turns.at(-1);
        if (!last || last.speaker !== "manager") {
          throw new Error("最后一轮不是经理回复,无法重新生成");
        }
        // 保存旧版本，回到以客户发言结尾的状态，复用生成路径。
        const observation = conversation.observations?.find((item) => item.managerTurnNumber === last.number);
        conversation.revisions = [...(conversation.revisions ?? []), { turn: structuredClone(last), replacedAt: now().toISOString(), ...(observation ? { observation } : {}) }];
        conversation.observations = conversation.observations?.filter((item) => item.managerTurnNumber !== last.number);
        conversation.turns = conversation.turns.slice(0, -1);
        return appendManagerTurn(conversation);
      });
    },

    async saveObservation(conversationId, observation) {
      return serialize(`conversation:${conversationId}`, async () => {
        const conversation = await requireConversation(conversationId);
        if (!observation || !Number.isInteger(observation.managerTurnNumber) ||
          !conversation.turns.some((turn) => turn.speaker === 'manager' && turn.number === observation.managerTurnNumber) ||
          (observation.judgement !== undefined && !['addressed', 'missed', 'uncertain'].includes(observation.judgement)) ||
          (observation.feeling !== undefined && !isFeelingStamp(observation.feeling)) ||
          typeof observation.evidence !== 'string' || typeof observation.nextExperiment !== 'string' ||
          observation.evidence.length > 2000 || observation.nextExperiment.length > 2000 ||
          typeof observation.revealed !== 'boolean' || typeof observation.marked !== 'boolean') throw new ValidationError('观察记录需指向已有经理轮，文字不超过2000字');
        const note: PlayerObservation = {
          managerTurnNumber: observation.managerTurnNumber, evidence: observation.evidence.trim(), nextExperiment: observation.nextExperiment.trim(),
          ...(observation.judgement ? { judgement: observation.judgement } : {}), revealed: observation.revealed, marked: observation.marked,
          ...(observation.feeling ? { feeling: observation.feeling } : {}),
        };
        conversation.observations = [...(conversation.observations ?? []).filter((item) => item.managerTurnNumber !== note.managerTurnNumber), note].sort((a, b) => a.managerTurnNumber - b.managerTurnNumber);
        conversation.revision = (conversation.revision ?? 0) + 1;
        await storage.saveConversation(conversation);
        return conversation;
      });
    },

    async branchConversation(conversationId, customerTurnNumber, replacementText) {
      return serialize(`conversation:${conversationId}`, async () => {
        const original = await requireConversation(conversationId);
        if (!Number.isInteger(customerTurnNumber) || typeof replacementText !== 'string' || !replacementText.trim() || replacementText.length > 4000) throw new ValidationError('请指定客户轮次与不超过4000字的新回应');
        const position = original.turns.findIndex((turn) => turn.number === customerTurnNumber && turn.speaker === 'customer');
        const manager = original.turns[position + 1];
        if (position < 0 || manager?.speaker !== 'manager') throw new ValidationError('只能从已有经理回应的客户轮创建分支');
        if (!original.resources || !original.productFacts) throw new ValidationError('旧局缺少资源快照，无法锁定分支前情；请新开一局后再试');
        const branch: Conversation = {
          id: randomId(), revision: 0, personaId: original.personaId, observationFocus: original.observationFocus,
          replayOfId: original.id, resources: structuredClone(original.resources), productFacts: structuredClone(original.productFacts),
          openingGoal: original.openingGoal, status: 'ongoing', createdAt: now().toISOString(), promptVersion: PROMPT_VERSION,
          turns: [...structuredClone(original.turns.slice(0, position)), { number: customerTurnNumber, speaker: 'customer', text: replacementText.trim() }],
          observations: structuredClone((original.observations ?? []).filter((note) => note.managerTurnNumber < customerTurnNumber)),
          branch: { originalId: original.id, customerTurnNumber, originalCustomerText: original.turns[position].text, originalManagerTurn: structuredClone(manager), conditionsPreserved: true },
        };
        const next = await appendManagerTurn(branch);
        await purgeExpiredConversations(storage, now(), retention);
        return next;
      });
    },

    async finishConversation(conversationId) {
      return serialize(`conversation:${conversationId}`, async () => {
        const conversation = await requireConversation(conversationId);
        if (conversation.status === "ended") return conversation;
        conversation.status = "ended";
        conversation.endReason = "客户主动结束通话";
        conversation.outcomeSummary = conversation.outcomeSummary || observedOutcome(conversation);
        conversation.revision = (conversation.revision ?? 0) + 1;
        await storage.saveConversation(conversation);
        return conversation;
      });
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

      // 每个经理轮的上一条客户发言:复盘链"客户原话→经理回应"的左端。
      function customerTextBefore(turnNumber: number): string {
        const index = conversation.turns.findIndex((t) => t.number === turnNumber);
        for (let i = index - 1; i >= 0; i -= 1) {
          const turn = conversation.turns[i];
          if (turn?.speaker === "customer") return turn.text;
        }
        return "(未记录)";
      }

      // 来源片段落为原始轮次:优先按素材 id 定位(标题可重名),旧数据回退按标题。
      function resolveSourceTurns(source: { materialId?: string; materialTitle: string; turnRange: string } | null) {
        if (!source) return [];
        const located = locateSourceMaterial(source, materials);
        if (!located) return [];
        return resolveTurnRange(source.turnRange, located.turns);
      }

      return {
        conversationId: conversation.id,
        ...(conversation.observationFocus ? { observationFocus: conversation.observationFocus } : {}),
        ...(conversation.replayOfId ? { replayOfId: conversation.replayOfId } : {}),
        ...(conversation.productFacts ? { productFacts: conversation.productFacts } : {}),
        ...(conversation.resources ? { resources: conversation.resources } : {}),
        ...(conversation.revisions?.length ? { revisions: conversation.revisions } : {}),
        ...(conversation.branch ? { branch: conversation.branch } : {}),
        ...(conversation.observations ? { observations: conversation.observations } : {}),
        mainGoal: conversation.openingGoal ?? '旧记录未保存开局目标',
        lastAction: goals.at(-1) ?? '未记录经理动作',
        outcome: conversation.outcomeSummary || observedOutcome(conversation),
        endReason: conversation.endReason || "未知",
        turns: conversation.turns,
        ...(conversation.promptVersion ? { promptVersion: conversation.promptVersion } : {}),
        strategyPath: managerTurns
          .filter((t) => t.usedCardId && (t.strategyEvidence?.cardId === t.usedCardId || cardsById.has(t.usedCardId)))
          .map((t) => {
            const card = cardsById.get(t.usedCardId as string);
            const evidence = t.strategyEvidence?.cardId === t.usedCardId ? t.strategyEvidence : undefined;
            const source = evidence?.source ?? card?.sourceExcerpt ?? null;
            return {
              turnNumber: t.number,
              cardId: t.usedCardId as string,
              cardName: evidence?.cardName ?? card!.name,
              keyExpression: t.text,
              customerText: customerTextBefore(t.number),
              ...(t.recognizedSignal ? { recognizedSignal: t.recognizedSignal } : {}),
              ...(t.currentGoal ? { currentGoal: t.currentGoal } : {}),
              ...(t.cardMatchBasis ? { matchBasis: t.cardMatchBasis } : {}),
              source,
              sourceTurns: evidence ? evidence.sourceTurns : resolveSourceTurns(source),
              evidenceOrigin: evidence ? "turn-snapshot" as const : "current-library" as const,
            };
          }),
      };
    },
  };
}

