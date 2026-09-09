import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_NAME,
  OpenAICompatibleModelAdapter,
} from "./adapters/openai-model-adapter";
import {
  SEED_CARDS,
  SEED_PERSONA,
  SEED_PERSONA_P03,
  SEED_PRODUCT_CARD,
  SEED_TRANSCRIPT,
} from "./domain/seed";
import {
  expectNoFabricatedIdentity,
  expectNoPlaceholderTokens,
  openingManagerTurnInput,
} from "./test/rule9";

/**
 * 真实模型冒烟测试(spec.md 测试决策):默认跳过,手动触发——
 *   MIMO_SMOKE=1 npx vitest run src/smoke.real.test.ts
 * 需要在 .env.local 或环境变量中配置 MIMO_API_KEY。
 */
const env = import.meta.env as Record<string, string | undefined>;
const suite = env.MIMO_SMOKE ? describe : describe.skip;

function createAdapter(): OpenAICompatibleModelAdapter {
  const apiKey = env.MIMO_API_KEY;
  if (!apiKey) throw new Error("缺少 MIMO_API_KEY,无法运行真实模型冒烟测试");
  return new OpenAICompatibleModelAdapter({
    apiKey,
    baseUrl: env.MIMO_BASE_URL || DEFAULT_MODEL_BASE_URL,
    model: env.MIMO_MODEL || DEFAULT_MODEL_NAME,
  });
}

suite("真实模型冒烟", () => {
  it("对种子转写稿返回结构化案例分析", { timeout: 300_000 }, async () => {
    const adapter = createAdapter();
    const { analysis, cards } = await adapter.analyzeTranscript(SEED_TRANSCRIPT);
    expect(analysis.scenario).toBeTruthy();
    expect(analysis.stages.length).toBeGreaterThan(0);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.name).toBeTruthy();
      expect(Array.isArray(card.actionChain)).toBe(true);
    }
  });

  it("对「喂」给出理财经理开场并引用策略卡", { timeout: 300_000 }, async () => {
    const adapter = createAdapter();
    // 只传可见信息:隐藏画像不越适配器边界(01 评审决议)。
    const output = await adapter.generateManagerTurn({
      persona: {
        id: SEED_PERSONA.id,
        name: SEED_PERSONA.name,
        visible: SEED_PERSONA.visible,
      },
      publishedCards: SEED_CARDS,
      product: SEED_PRODUCT_CARD,
      history: [],
      customerText: "喂",
    });
    expect(output.reply).toBeTruthy();
    expect(output.reply).not.toMatch(/^(经理|理财经理)[:：]/);
    expect(output.usedCardId).toBeTruthy();
  });

  it("规则9回归:可见信息无代发时,开场不得假设客户为代发客户(票11,demo-03 同场景)", { timeout: 300_000 }, async () => {
    const adapter = createAdapter();
    // P03(定期到期·话少客户)可见信息不含代发关系;demo-03 曾在此场景
    // 首轮凭空称客户为「代发客户」。断言与伪适配器钉子共用
    // src/test/rule9.ts 的防护定义。
    const output = await adapter.generateManagerTurn(
      openingManagerTurnInput(SEED_PERSONA_P03.visible),
    );
    expectNoFabricatedIdentity(output.reply);
    expectNoPlaceholderTokens(output.reply);
  });
});
