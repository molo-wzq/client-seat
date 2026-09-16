import { describe, expect, it } from "vitest";
import { assembleAnalystSystemPrompt, assembleManagerMetaPrompt, assembleManagerSystemPrompt } from "./prompts";
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

describe("两段式输出契约(票 29)", () => {
  it("经理话术提示词要求纯文本输出,不再索要 JSON", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).not.toContain("只输出 JSON");
    expect(prompt).toMatch(/不加「理财经理:」等称谓前缀/);
    expect(prompt).toMatch(/不输出 JSON/);
  });

  it("元数据裁判提示词给出卡清单并只索要 JSON", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: SEED_CARDS });
    expect(prompt).toContain("usedCardId 只能取这里的 id");
    for (const card of SEED_CARDS) {
      expect(prompt).toContain(card.id);
      expect(prompt).toContain(card.name);
    }
    expect(prompt).toContain("只输出 JSON");
    expect(prompt).not.toContain("reply");
  });

  it("无已发布卡时裁判提示词写明空库", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: [] });
    expect(prompt).toContain("无已发布策略卡");
  });
});

describe("KYC 探询质量(票 30)", () => {
  it("规则 4 给出资金现状最小清单,行外资金优先", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("行外资金");
    expect(prompt).toContain("他行存款/他行理财/证券/定期");
    expect(prompt).toContain("闲置资金大概多少");
    expect(prompt).toMatch(/优先摸清/);
  });

  it("规则 11 探询纪律:一次一问、线索后追问一层、空转即收手", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("一次只问一个问题");
    expect(prompt).toContain("先接住确认,再顺着追问一层");
    expect(prompt).toContain("不拿到一个线索就急着推产品");
    expect(prompt).toContain("连续两轮没有新信息就停止追问");
  });

  it("分析提示词要求探询类动作链写明维度与追问", () => {
    const prompt = assembleAnalystSystemPrompt();
    expect(prompt).toContain("问的是哪个维度");
    expect(prompt).toContain("客户给出线索后追问什么");
    expect(prompt).toContain("这类空动作的卡不可复用");
  });
});
