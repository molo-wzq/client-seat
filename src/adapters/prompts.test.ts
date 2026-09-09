import { describe, expect, it } from "vitest";
import { assembleAnalystSystemPrompt, assembleManagerSystemPrompt } from "./prompts";
import {
  SEED_CARDS,
  SEED_PERSONA,
  SEED_PERSONA_P03,
  SEED_PRODUCT_CARD,
} from "../domain/seed";

/**
 * 规则 9 客户属性防护(票 11):真实模型曾在可见信息无"代发"时
 * 把客户称作「代发客户」(demo-03)。提示词必须给出带反例的明确禁令,
 * 且开场来意示例与策略卡示例不得诱导身份断言。
 */
const P03_VISIBLE = SEED_PERSONA_P03.visible;

function promptFor(visible: string[]): string {
  return assembleManagerSystemPrompt({
    persona: { id: "p-test", name: "测试画像", visible },
    publishedCards: SEED_CARDS,
    product: SEED_PRODUCT_CARD,
  });
}

describe("经理系统提示词:规则 9 客户属性防护", () => {
  it("可见信息无代发时,提示词含带反例的明确禁令", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("不凭空假设客户属性");
    // 反例点名具体身份类别,不含糊。
    expect(prompt).toContain("不得称客户为「代发客户」");
    expect(prompt).toContain("贵宾");
    expect(prompt).toContain("三方存管");
  });

  it("写明「产品事实可说、客户身份不可断言」的边界", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("不得据此断言客户本人属于该类");
  });

  it("策略卡示例中的客户属性仅在可见信息支持时使用", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("仅当可见信息支持时才对客户使用");
  });

  it("骨架占位符须填充或改用自然称呼,不得原样输出(票11 并入病灶)", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toMatch(/占位符/);
    expect(prompt).toMatch(/不得原样输出/);
  });

  it("开场来意示例不再以「代发客户」为固定例子(旧诱导措辞移除)", () => {
    for (const visible of [P03_VISIBLE, SEED_PERSONA.visible]) {
      const prompt = promptFor(visible);
      expect(prompt).not.toContain("如告知代发客户的资金活动");
    }
  });

  it("规则 6 补充收口渠道句:一句为限、无后续钩子(票 13)", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toMatch(/礼貌收口[\s\S]{0,80}联系渠道/);
    expect(prompt).toContain("一句为限");
    expect(prompt).toContain("过阵子再联系");
    expect(prompt).toContain("不编造自己姓名");
  });

  it("可见信息本身仍完整进入提示词(代发画像不受影响)", () => {
    const prompt = promptFor(SEED_PERSONA.visible);
    expect(prompt).toContain("代发工资客户,代发关系正常");
  });
});

describe("分析提示词:场景读法(票 14)", () => {
  it("区分「到账」与「到期」,按转写原文用词判断、不得混用", () => {
    const prompt = assembleAnalystSystemPrompt();
    expect(prompt).toContain("区分「到账」与「到期」");
    expect(prompt).toContain("期限届满");
    expect(prompt).toContain("不得混用");
    expect(prompt).toMatch(/按转写原文用词判断/);
  });
});
