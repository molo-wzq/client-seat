import { describe, expect, it } from "vitest";
import {
  normalizeAnalysis,
  normalizeCard,
} from "../adapters/openai-model-adapter";
import { createInProcessProductApi } from "../product/in-process-product-api";
import { RecordingAdapter } from "../test/recording-adapter";
import { SEED_TRANSCRIPT } from "./seed";
import { numberTurns, parseTurnRange, parseTranscriptTurns } from "./transcript";
import type { Material, MaterialTurn } from "./types";

async function analyzedMaterial(): Promise<{
  api: ReturnType<typeof createInProcessProductApi>;
  recording: RecordingAdapter;
  material: Material;
}> {
  const recording = new RecordingAdapter();
  const api = createInProcessProductApi({ adapter: recording });
  // 用种子转写稿:种子策略卡的来源轮次区间(T01–T26)须能在轮次中对回。
  const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
  return { api, recording, material };
}

describe("转写稿解析", () => {
  it("识别轮次标注与说话人标签,无标注行按交替归属", () => {
    const turns = parseTranscriptTurns(
      ["T01 经理:您好", "客户A:喂", "我是小李,银行的客户经理", "嗯,你说"].join("\n"),
    );
    expect(turns).toHaveLength(4);
    expect(turns[0]).toMatchObject({ number: 1, speaker: "manager", text: "您好" });
    expect(turns[1]).toMatchObject({ speaker: "customer", text: "喂" });
    // 无标注行按 manager/customer 交替兜底,由用户在界面上纠正。
    expect(turns[2]?.speaker).toBe("manager");
    expect(turns[3]?.speaker).toBe("customer");
  });

  it("解析轮次区间为序号数组", () => {
    expect(parseTurnRange("T01–T02")).toEqual([1, 2]);
    expect(parseTurnRange("T14")).toEqual([14]);
    expect(parseTurnRange("第3–5句")).toEqual([3, 4, 5]);
    expect(parseTurnRange("未知")).toEqual([]);
  });

  it("转写标注跳号时序号保留标注值,保证来源区间可对回", () => {
    const turns = numberTurns(parseTranscriptTurns("T01 经理:a\nT03 客户:b"));
    expect(turns.map((t) => t.number)).toEqual([1, 3]);
  });
});

describe("策略提炼与人工发布", () => {
  it("分析结果包含规格必需字段,说话人区分保存为可纠正的轮次", async () => {
    const { material } = await analyzedMaterial();

    const { analysis } = material;
    expect(analysis.scenario).toBeTruthy();
    expect(analysis.customerState).toBeTruthy();
    expect(analysis.overallGoal).toBeTruthy();
    expect(analysis.stages.length).toBeGreaterThan(0);
    for (const stage of analysis.stages) {
      expect(stage.name).toBeTruthy();
      expect(stage.purpose).toBeTruthy();
      expect(stage.customerSignals).toBeTruthy();
      expect(stage.advanceLogic).toBeTruthy();
      expect(stage.keyActions.length).toBeGreaterThan(0);
    }
    expect(analysis.strengths.length).toBeGreaterThan(0);
    expect(analysis.actualResult).toBeTruthy();
    expect(analysis.reusableConditions.length).toBeGreaterThan(0);

    expect(material.turns.length).toBe(26);
    expect(material.turns[0]).toMatchObject({ number: 1, speaker: "manager" });
    expect(material.turns[2]).toMatchObject({ number: 3, speaker: "customer" });
    expect(material.cards).toHaveLength(3);
    expect(material.cards.every((c) => c.status === "draft")).toBe(true);
  });

  it("允许用户纠正说话人并保存", async () => {
    const { api, material } = await analyzedMaterial();
    const flipped: MaterialTurn[] = material.turns.map((t, i) => ({
      ...t,
      speaker: i % 2 === 0 ? "customer" : "manager",
    }));
    const updated = await api.updateMaterialDraft(material.id, { turns: flipped });
    expect(updated.turns).toHaveLength(material.turns.length);
    expect(updated.turns.map((t) => t.speaker).slice(0, 2)).toEqual(["customer", "manager"]);
    // 轮次序号保持 1..n,作为来源追溯坐标。
    expect(updated.turns.map((t) => t.number)).toEqual(
      Array.from({ length: material.turns.length }, (_, i) => i + 1),
    );
  });

  it("用户可以编辑分析结果与策略卡并保存为草稿", async () => {
    const { api, material } = await analyzedMaterial();
    const editedCard = {
      ...material.cards[0]!,
      name: "改后的开场卡",
      triggerSignals: ["电话接通", "客户语气平静"],
    };
    const updated = await api.updateMaterialDraft(material.id, {
      analysis: { ...material.analysis, scenario: "编辑后的场景描述" },
      cards: [editedCard],
    });
    expect(updated.analysis.scenario).toBe("编辑后的场景描述");
    const saved = updated.cards.find((c) => c.id === editedCard.id)!;
    expect(saved.name).toBe("改后的开场卡");
    expect(saved.triggerSignals).toEqual(["电话接通", "客户语气平静"]);
    // 编辑不改变草稿状态与来源关系。
    expect(saved.status).toBe("draft");
    expect(saved.sourceExcerpt.materialTitle).toBe(updated.title);
  });

  it("已发布的策略卡不允许通过草稿编辑接口修改", async () => {
    const { api, material } = await analyzedMaterial();
    await api.publishMaterialCards(material.id);
    const publishedCard = material.cards[0]!;
    await expect(
      api.updateMaterialDraft(material.id, {
        cards: [{ ...publishedCard, name: "不应生效" }],
      }),
    ).rejects.toThrow(/已发布/);
  });

  it("发布前草稿卡不进入对话检索,发布后才可检索", async () => {
    const { api, recording, material } = await analyzedMaterial();

    const before = await api.startConversation("p01-daifagua");
    await api.sendCustomerTurn(before.id, "喂");
    expect(recording.dialogueInputs.at(-1)?.publishedCards).toHaveLength(0);

    await api.publishMaterialCards(material.id);
    const after = await api.startConversation("p01-daifagua");
    await api.sendCustomerTurn(after.id, "喂");
    const cards = recording.dialogueInputs.at(-1)?.publishedCards ?? [];
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => c.id))).toEqual(new Set(material.cards.map((c) => c.id)));
  });

  it("允许只发布部分策略卡,未发布卡不进入检索", async () => {
    const { api, recording, material } = await analyzedMaterial();
    await api.publishCards(material.id, [material.cards[0]!.id]);

    const conversation = await api.startConversation("p01-daifagua");
    await api.sendCustomerTurn(conversation.id, "喂");
    const cards = recording.dialogueInputs.at(-1)?.publishedCards ?? [];
    expect(cards.map((c) => c.id)).toEqual([material.cards[0]!.id]);
  });

  it("策略卡与原始转写片段的来源关系可对回轮次", async () => {
    const { material } = await analyzedMaterial();
    const turnNumbers = new Set(material.turns.map((t) => t.number));
    for (const card of material.cards) {
      expect(card.sourceExcerpt.materialTitle).toBe(material.title);
      const range = parseTurnRange(card.sourceExcerpt.turnRange);
      expect(range.length).toBeGreaterThan(0);
      for (const n of range) {
        expect(turnNumbers.has(n)).toBe(true);
      }
    }
  });
});

describe("模型输出归一化(无法确认的信息保持未知)", () => {
  it("缺失字段归一为未知,不猜测、不补全", () => {
    const analysis = normalizeAnalysis({});
    expect(analysis.scenario).toBe("未知");
    expect(analysis.customerState).toBe("未知");
    expect(analysis.stages).toEqual([]);
    expect(analysis.weaknesses).toEqual([]);

    const card = normalizeCard({}, 0);
    expect(card.name).toBe("未命名策略卡");
    expect(card.triggerSignals).toEqual([]);
    expect(card.id).toBe("sc-1");
  });

  it("保留有效的模型输出", () => {
    const analysis = normalizeAnalysis({
      scenario: "存量生客首次触达",
      strengths: ["开场给退路"],
    });
    expect(analysis.scenario).toBe("存量生客首次触达");
    expect(analysis.strengths).toEqual(["开场给退路"]);
    expect(analysis.weaknesses).toEqual([]);
  });
});
