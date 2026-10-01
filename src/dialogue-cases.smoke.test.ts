import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_NAME,
  OpenAICompatibleModelAdapter,
} from "./adapters/openai-model-adapter";
import { DIALOGUE_CASES, runDialogueCase } from "./test/dialogue-cases";

/**
 * 对照案例集(真实模型冒烟,dialogue-guardrails spec A):默认跳过,手动触发——
 *   MIMO_SMOKE=1 npx vitest run src/dialogue-cases.smoke.test.ts
 * 需要 .env.local 配置 MIMO_API_KEY。基线先跑一遍;仅波动或重要边界案例
 * 重复取样,不默认全矩阵反复跑。断言只含结构性边界,自然度人工复核。
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

suite("对话对照案例(真实模型基线)", () => {
  for (const testCase of DIALOGUE_CASES) {
    it(
      `${testCase.id}:${testCase.title}`,
      { timeout: 600_000 },
      async () => {
        const { history, outputs } = await runDialogueCase(createAdapter(), testCase);
        expect(history.length).toBeGreaterThanOrEqual(2);
        // 基线留档:控制台输出完整往返,便于人工复核话术自然度与跨画像迁移。
        for (let i = 0; i < history.length; i += 2) {
          const meta = outputs[i / 2];
          console.info(
            `[case:${testCase.id}] 客户:${history[i]?.text}\n[case:${testCase.id}] 经理:${history[i + 1]?.text}` +
              (meta?.usedCardId ? `(用卡:${meta.usedCardId})` : ""),
          );
        }
      },
    );
  }
});
