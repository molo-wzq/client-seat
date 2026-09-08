import { describe, expect, it } from "vitest";
import { assembleManagerSystemPrompt } from "../adapters/prompts";
import { createInProcessProductApi } from "../product/in-process-product-api";
import { RecordingAdapter } from "../test/recording-adapter";
import { SEED_PERSONA, SEED_PERSONAS, SEED_PRODUCT_CARD } from "./seed";

const VISIBLE_LINE = "客户是代发工资客户,代发关系正常";
const HIDDEN_LINE = "可动用闲钱约15万,其余资金在股市";

async function apiWithCustomPersona() {
  const recording = new RecordingAdapter();
  const api = createInProcessProductApi({ adapter: recording });
  const persona = await api.savePersona({
    name: "自定义生客",
    visible: [VISIBLE_LINE],
    hidden: [HIDDEN_LINE],
  });
  return { api, recording, persona };
}

describe("生客画像", () => {
  it("内置画像 3 个(P01–P03,提取自真实素材),自定义画像并入列表", async () => {
    const { api, persona } = await apiWithCustomPersona();
    const list = await api.listPersonas();
    expect(SEED_PERSONAS).toHaveLength(3);
    for (const builtIn of SEED_PERSONAS) {
      expect(list.some((p) => p.id === builtIn.id)).toBe(true);
    }
    expect(list.some((p) => p.id === SEED_PERSONA.id)).toBe(true);
    // 自定义画像排在全部内置画像之后
    expect(list.at(-1)?.name).toBe("自定义生客");
    expect(list.find((p) => p.id === persona.id)?.name).toBe("自定义生客");
  });

  it("自定义画像按提交保存,留空字段保持未知,不自动补全", async () => {
    const { api } = await apiWithCustomPersona();
    const empty = await api.savePersona({ name: "空白画像", visible: [], hidden: [] });
    expect(empty.visible).toEqual([]);
    expect(empty.hidden).toEqual([]);

    const listed = await api.listPersonas();
    const saved = listed.find((p) => p.name === "空白画像");
    expect(saved?.visible).toEqual([]);
    expect(saved?.hidden).toEqual([]);
  });

  it("对话生成只收到可见信息,隐藏信息不越适配器边界", async () => {
    const { api, recording, persona } = await apiWithCustomPersona();
    const conversation = await api.startConversation(persona.id);
    await api.sendCustomerTurn(conversation.id, "喂");

    const input = recording.dialogueInputs.at(-1)!;
    expect(input.persona.visible).toEqual([VISIBLE_LINE]);
    // 隐藏信息不出现在对话生成的任何入参里(角色只能通过对话发现)。
    expect(JSON.stringify(input)).not.toContain("15万");
    expect(JSON.stringify(input)).not.toContain(HIDDEN_LINE);
  });

  it("提示词组装包含可见信息、绝不含隐藏信息,空画像也能成立", () => {
    const prompt = assembleManagerSystemPrompt({
      persona: { id: "p1", name: "p", visible: [VISIBLE_LINE] },
      publishedCards: [],
      product: SEED_PRODUCT_CARD,
    });
    expect(prompt).toContain(VISIBLE_LINE);
    expect(prompt).toContain("一无所知");
    // 隐藏字段没有传入 persona,自然不该出现——这条断言守住的是组装逻辑本身。
    expect(prompt).not.toContain("15万");

    const emptyPrompt = assembleManagerSystemPrompt({
      persona: { id: "p1", name: "p", visible: [] },
      publishedCards: [],
      product: SEED_PRODUCT_CARD,
    });
    expect(emptyPrompt).toContain("一无所知");
    expect(emptyPrompt).not.toContain("15万");
  });

  it("使用自定义画像能完成对话(不依赖种子画像)", async () => {
    const { api, persona } = await apiWithCustomPersona();
    const conversation = await api.startConversation(persona.id);
    const after = await api.sendCustomerTurn(conversation.id, "喂");
    expect(after.turns.length).toBe(2);
    expect(after.turns[1]?.speaker).toBe("manager");
  });
});
