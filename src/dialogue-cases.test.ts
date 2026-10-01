import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "./adapters/fake-model-adapter";
import { DIALOGUE_CASES, runDialogueCase } from "./test/dialogue-cases";

/**
 * 对照案例集(伪适配器端到端,dialogue-guardrails spec A):
 * 同一份案例定义驱动伪适配器(常跑)与真实模型冒烟
 * (src/dialogue-cases.smoke.test.ts)。这里钉住的是结构性边界——
 * 单问、句数、数字来源、资格条件式、拒绝计数与收口时点;
 * 话术自然度与跨画像措辞迁移以真模型基线人工复核为准。
 */
describe("对话对照案例(伪适配器)", () => {
  for (const testCase of DIALOGUE_CASES) {
    it(`${testCase.id}:${testCase.title}`, async () => {
      const { history } = await runDialogueCase(new FakeModelAdapter(), testCase);
      // 案例至少跑完一轮完整的客户→经理往返。
      expect(history.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < history.length; i += 2) {
        expect(history[i]?.speaker).toBe("customer");
        expect(history[i + 1]?.speaker).toBe("manager");
      }
    });
  }

  it("案例集覆盖 spec A 列出的全部观察点(迁移/停止/收益/资格/下一步/否定引用)", () => {
    const ids = DIALOGUE_CASES.map((c) => c.id);
    expect(ids).toContain("cross-p01-stock-clue");
    expect(ids).toContain("cross-p02-maturity-clue");
    expect(ids).toContain("cross-p03-terse-clue");
    expect(ids).toContain("stop-intent-ladder");
    expect(ids).toContain("explicit-stop-first");
    expect(ids).toContain("returns-question");
    expect(ids).toContain("unknown-eligibility");
    expect(ids).toContain("next-step-close");
    expect(ids).toContain("legal-negation-quote");
    // 轮次上限不由案例覆盖:由 adaptive-conversation"达到经理轮数上限"钉住。
    for (const testCase of DIALOGUE_CASES) {
      expect(testCase.source, `案例 ${testCase.id} 缺来源`).toBeTruthy();
    }
  });
});
