import { describe, expect, it, vi } from 'vitest';
import { createProductCore } from './product-core';
import { InMemoryStorage } from '../product/in-process-product-api';
import { FakeModelAdapter } from '../adapters/fake-model-adapter';
import { factRelationNotes, hasOutOfCardNumber } from './product-facts';
import { SEED_PRODUCT_CARD } from './seed';
import type { ManagerTurnInput } from './ports';

function fixture() {
  const storage = new InMemoryStorage();
  const generateManagerTurn = vi.fn(async (input: ManagerTurnInput) => ({ reply: '您希望了解哪些条件？', usedCardId: input.publishedCards[0]?.id, cardMatchBasis: '执行征询动作' }));
  const core = createProductCore({ storage, dialogue: { generateManagerTurn }, copywriting: new FakeModelAdapter() });
  return { core, storage, generateManagerTurn };
}

describe('设计修复：意图、事实与可信对照', () => {
  it('明确离场无需等待模型、自然流式收口且不附赠授权', async () => {
    const { core, generateManagerTurn } = fixture();
    const call = await core.quickStart();
    const delta = vi.fn();
    const ended = await core.sendCustomerTurnStream(call.id, '别再打电话了，我现在要挂了。', delta);
    expect(ended.status).toBe('ended');
    expect(generateManagerTurn).not.toHaveBeenCalled();
    expect(delta).toHaveBeenCalledWith(ended.turns[1].text);
    expect(ended.outcomeSummary).not.toMatch(/已报名|同意微信/);
  });
  it('开局冻结画像、策略、来源；本局和同客重试不被后来发布影响', async () => {
    const { core, storage, generateManagerTurn } = fixture();
    const first = await core.quickStart();
    const material = (await core.listMaterials())[0];
    await storage.saveMaterial({ ...material, cards: [], turns: [] });
    await core.sendCustomerTurn(first.id, '喂');
    expect(generateManagerTurn.mock.calls[0][0].publishedCards).toEqual(first.resources!.cards);
    expect(generateManagerTurn.mock.calls[0][0].persona).not.toHaveProperty('hidden');
    await core.finishConversation(first.id);
    const retry = await core.startConversation(first.personaId, { replayOfId: first.id });
    expect(retry.resources).toEqual(first.resources);
    expect(retry.productFacts).toEqual(first.productFacts);
    expect((await core.getResult(first.id)).strategyPath[0].sourceTurns.length).toBeGreaterThan(0);
  });
  it('无匹配依据的卡 id 不伪装成已确认用卡', async () => {
    const { core, generateManagerTurn } = fixture();
    const call = await core.quickStart();
    generateManagerTurn.mockResolvedValueOnce({ reply: '您好', usedCardId: call.resources!.cards[0].id, cardMatchBasis: '' });
    const next = await core.sendCustomerTurn(call.id, '喂');
    expect(next.turns[1].usedCardId).toBeUndefined();
  });
  it('重复无依据数字依然提示，金额和权益各存在仍核对对应', () => {
    expect(hasOutOfCardNumber('参考年化4%', SEED_PRODUCT_CARD, [{ number: 2, speaker: 'manager', text: '参考年化4%' }])).toBe(true);
    expect(factRelationNotes('您存5万就拿150元。', SEED_PRODUCT_CARD)).toHaveLength(1);
    expect(factRelationNotes('您这15万到20万档，能拿150块立减金。', SEED_PRODUCT_CARD)).toEqual([]);
    expect(factRelationNotes('不是5万拿150元。', SEED_PRODUCT_CARD)).toEqual([]);
    expect(factRelationNotes('“5万拿150元”是客户的疑问。', SEED_PRODUCT_CARD)).toEqual([]);
  });
  it('重生成保留原文，分支保留前情与当时条件且原局不变', async () => {
    const { core } = fixture();
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, '喂');
    const second = await core.sendCustomerTurn(call.id, '怎么取用？');
    const regenerated = await core.regenerateManagerTurn(call.id);
    expect(regenerated.revisions?.[0].turn).toEqual(second.turns[3]);
    const branch = await core.branchConversation(call.id, 3, '这笔钱明天就要用');
    expect(branch.turns.slice(0, 2)).toEqual(second.turns.slice(0, 2));
    expect(branch.turns[2].text).toBe('这笔钱明天就要用');
    expect(branch.resources).toEqual(call.resources);
    expect(branch.branch?.originalManagerTurn).toEqual(regenerated.turns[3]);
    expect((await core.getConversation(call.id)).turns).toEqual(regenerated.turns);
    await expect(core.branchConversation(call.id, 2, '换一句')).rejects.toThrow('客户轮');
  });
  it('主动结束保留开局目标，最后动作和事实摘要分开', async () => {
    const { core } = fixture();
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, '喂');
    await core.finishConversation(call.id);
    const result = await core.getResult(call.id);
    expect(result.mainGoal).toBe(call.openingGoal);
    expect(result.lastAction).toBe('未记录经理动作');
    expect(result.outcome).toContain('1 轮经理回应');
    expect(result.outcome).not.toBe('未知');
  });
  it('观察持久保存、不进入经理输入；重生成的判断随原版本保存', async () => {
    const { core, generateManagerTurn } = fixture();
    const call = await core.quickStart();
    const first = await core.sendCustomerTurn(call.id, '喂');
    const note = { managerTurnNumber: 2, judgement: 'uncertain' as const, evidence: '私人观察', nextExperiment: '下次的假设', revealed: true, marked: true };
    const saved = await core.saveObservation(call.id, note);
    expect(saved.revision).toBeGreaterThan(first.revision!);
    const next = await core.regenerateManagerTurn(call.id);
    expect(next.revisions?.[0].observation).toEqual(note);
    expect(next.observations).toEqual([]);
    expect(JSON.stringify(generateManagerTurn.mock.calls.at(-1))).not.toContain('私人观察');
    await expect(core.saveObservation(call.id, { ...note, managerTurnNumber: 1 })).rejects.toThrow('已有经理轮');
    await core.finishConversation(call.id);
    const ended = await core.saveObservation(call.id, note);
    expect(ended.status).toBe('ended');
    expect((await core.getResult(call.id)).observations).toEqual([note]);
  });
});
