import { describe, expect, it, vi } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { InMemoryStorage } from "../product/in-process-product-api";
import { createProductCore } from "./product-core";
import type { ManagerTurnInput } from "./ports";
import { SEED_PERSONA_P02 } from "./seed";
import { PROMPT_VERSION } from "./prompt-version";

function fixture() {
  const storage = new InMemoryStorage();
  const generateManagerTurn = vi.fn(async (input: ManagerTurnInput) => ({
    reply: "我先听听您的顾虑，您希望了解哪方面？",
    usedCardId: input.publishedCards[0]?.id,
    cardMatchBasis: "对应征询动作（测试候选）",
  }));
  const core = createProductCore({ storage, copywriting: new FakeModelAdapter(), dialogue: { generateManagerTurn } });
  return { core, storage, generateManagerTurn };
}

describe("透镜改进:历史证据与学习循环", () => {
  it.each(["先别帮我报名", "帮我报名需要什么条件？", "他说‘帮我报上吧’，我还没决定", "如果我说帮我报名会怎么样？", "可以先讲清楚报名条件吗？"])("演示脚本不把非授权句「%s」判为报名承诺", async (text) => {
    const adapter = new FakeModelAdapter();
    const core = createProductCore({ storage: new InMemoryStorage(), copywriting: adapter, dialogue: adapter });
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "喂");
    const next = await core.sendCustomerTurn(call.id, text);
    expect(next.status).toBe("ongoing");
    expect(next.outcomeSummary).toBeUndefined();
    expect(next.turns.at(-1)?.text).not.toMatch(/帮您把20万|这一档报上/);
  });

  it("只同意微信的演示局不会附赠报名或硬填20万档", async () => {
    const adapter = new FakeModelAdapter();
    const core = createProductCore({ storage: new InMemoryStorage(), copywriting: adapter, dialogue: adapter });
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "喂");
    const next = await core.sendCustomerTurn(call.id, "加微信");
    expect(next.status).toBe("ended");
    expect(next.turns.at(-1)?.text).toContain("不替您报名");
    expect(next.outcomeSummary).not.toMatch(/报名|20万/);
  });

  it("同意报名也不会自动变成同意微信或虚构资金档位", async () => {
    const adapter = new FakeModelAdapter();
    const core = createProductCore({ storage: new InMemoryStorage(), copywriting: adapter, dialogue: adapter });
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "喂");
    const next = await core.sendCustomerTurn(call.id, "帮我报上吧");
    expect(next.status).toBe("ended");
    expect(next.outcomeSummary).toContain("核对报名条件");
    expect(next.outcomeSummary).not.toMatch(/微信|20万/);
  });

  it("素材被纠正甚至当前卡不再可取时,旧局仍回放本轮实际保存的来源", async () => {
    const { core, storage } = fixture();
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "喂");
    await core.finishConversation(call.id);
    const before = await core.getResult(call.id);
    expect(before.strategyPath[0].sourceTurns.length).toBeGreaterThan(0);
    expect(before.strategyPath[0].evidenceOrigin).toBe("turn-snapshot");
    const material = (await core.listMaterials())[0];
    await core.updateMaterialDraft(material.id, { turns: material.turns.map((t) => ({ ...t, text: "后来纠正的素材内容" })) });
    expect((await core.getResult(call.id)).strategyPath).toEqual(before.strategyPath);
    await storage.saveMaterial({ ...material, cards: [] });
    expect((await core.getResult(call.id)).strategyPath).toEqual(before.strategyPath);
  });

  it("旧局无快照时标注当前库回溯,不谎称保存了当时证据", async () => {
    const { core, storage } = fixture();
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "喂");
    const ended = await core.finishConversation(call.id);
    await storage.saveConversation({ ...ended, turns: ended.turns.map(({ strategyEvidence: _old, ...turn }) => turn) });
    expect((await core.getResult(call.id)).strategyPath[0].evidenceOrigin).toBe("current-library");
  });

  it.each([true, false])("来源 id 失效或旧标题重名时不会借用其他素材冒充来源:带 id=%s", async (withId) => {
    const { core, storage } = fixture();
    const call = await core.quickStart();
    const material = (await core.listMaterials())[0];
    await storage.saveMaterial({ ...material, cards: material.cards.map((card) => ({ ...card, sourceExcerpt: { materialTitle: material.title, turnRange: card.sourceExcerpt.turnRange, ...(withId ? { materialId: "missing-material" } : {}) } })) });
    await storage.saveMaterial({ ...material, id: "same-title-other", cards: [], turns: [{ number: 1, speaker: "manager", text: "另一份同标题素材,不能借用" }] });
    // 新局冻结当前的无效来源，不能借用其他素材；原局的旧快照仍有效。
    const next = await core.startConversation(call.personaId);
    await core.sendCustomerTurn(next.id, "喂");
    await core.finishConversation(next.id);
    expect((await core.getResult(next.id)).strategyPath[0].sourceTurns).toEqual([]);
  });

  it("生成沿用本局已保存参数,各轮版本不冒充开局时的旧版本", async () => {
    const { core, storage, generateManagerTurn } = fixture();
    const call = await core.quickStart();
    const productFacts = { ...call.productFacts!, activity: { ...call.productFacts!.activity, deadline: "测试局保存的截止时间" } };
    await storage.saveConversation({ ...call, promptVersion: "old-opening", productFacts });
    const next = await core.sendCustomerTurn(call.id, "活动截止什么时候？");
    expect(generateManagerTurn.mock.calls[0][0].product).toEqual(productFacts);
    expect(next.turns[1].promptVersion).toBe(PROMPT_VERSION);
    expect(next.promptVersion).toBe("old-opening");
    await core.finishConversation(call.id);
    expect((await core.getResult(call.id)).productFacts).toEqual(productFacts);
  });

  it("事实核对候选随实际经理轮保存,无用卡也不会丢失核对入口", async () => {
    const storage = new InMemoryStorage();
    const core = createProductCore({ storage, copywriting: new FakeModelAdapter(), dialogue: { generateManagerTurn: async () => ({ reply: "活动也面向三方存管客户", factCheckNotes: ["把产品对象套到了活动,请核对参数。"] }) } });
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "有啥条件？");
    await core.finishConversation(call.id);
    const result = await core.getResult(call.id);
    expect(result.turns[1].factCheckNotes).toEqual(["把产品对象套到了活动,请核对参数。"]);
    expect(result.strategyPath).toEqual([]);
  });

  it("观察点/重试关联持久保存,不把观察点、隐藏牌或来源快照发给模型", async () => {
    const { core, generateManagerTurn } = fixture();
    const first = await core.quickStart();
    await core.finishConversation(first.id);
    const next = await core.startConversation(first.personaId, { observationFocus: "conditions", replayOfId: first.id });
    await core.sendCustomerTurn(next.id, "喂");
    await core.sendCustomerTurn(next.id, "规则怎么参加？");
    const input = generateManagerTurn.mock.calls[1][0];
    expect(input).not.toHaveProperty("observationFocus");
    expect(input).not.toHaveProperty("replayOfId");
    expect(input.persona).not.toHaveProperty("hidden");
    expect(input.history.every((t) => !t.strategyEvidence)).toBe(true);
    expect((await core.getConversation(next.id))).toMatchObject({ observationFocus: "conditions", replayOfId: first.id });
    await core.finishConversation(next.id);
    expect(await core.getResult(next.id)).toMatchObject({ observationFocus: "conditions", replayOfId: first.id });
    const retry = await core.startConversation(next.personaId, { replayOfId: next.id });
    expect(retry.observationFocus).toBe("conditions");
    expect(retry.turns).toEqual([]);
    expect((await core.getConversation(first.id)).turns).toEqual([]);
  });

  it("不能把其他客户或未结束的对局当原局,非法观察点拒绝且不新建记录", async () => {
    const { core } = fixture();
    const call = await core.quickStart();
    await expect(core.startConversation(call.personaId, { replayOfId: call.id })).rejects.toThrow("已结束");
    await core.finishConversation(call.id);
    await expect(core.startConversation(SEED_PERSONA_P02.id, { replayOfId: call.id })).rejects.toThrow("同一客户");
    await expect(core.startConversation(call.personaId, { observationFocus: "score" as never })).rejects.toThrow("观察点不合法");
    expect(await core.listConversations()).toHaveLength(1);
  });

  it("幻觉用卡不会被保存为来源证据", async () => {
    const { core, generateManagerTurn } = fixture();
    generateManagerTurn.mockResolvedValueOnce({ reply: "您好", usedCardId: "imaginary-card", cardMatchBasis: "虚构" });
    const call = await core.quickStart();
    const next = await core.sendCustomerTurn(call.id, "喂");
    expect(next.turns[1].usedCardId).toBeUndefined();
    expect(next.turns[1].strategyEvidence).toBeUndefined();
    await core.finishConversation(call.id);
    expect((await core.getResult(call.id)).strategyPath).toEqual([]);
  });

  it("存储上限清理原局后,新局保留关联但仍能独立结算", async () => {
    const storage = new InMemoryStorage();
    let time = 0;
    const adapter = new FakeModelAdapter();
    const core = createProductCore({ storage, copywriting: adapter, dialogue: adapter, retention: { maxAgeMs: null, maxCount: 1 }, now: () => new Date(++time * 1000) });
    const first = await core.quickStart();
    await core.finishConversation(first.id);
    const next = await core.startConversation(first.personaId, { replayOfId: first.id });
    await core.finishConversation(next.id);
    await expect(core.getResult(first.id)).rejects.toThrow("不存在");
    expect(await core.getResult(next.id)).toMatchObject({ replayOfId: first.id, turns: [] });
  });
});
