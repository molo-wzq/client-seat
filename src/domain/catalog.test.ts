import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { createInProcessProductCore, InMemoryStorage } from "../product/in-process-product-api";
import { SEED_PERSONAS, SEED_TRANSCRIPT, buildSeedMaterial } from "./seed";
import { MATERIAL_KINDS } from "./types";

function setup() {
  const storage = new InMemoryStorage();
  const api = createInProcessProductCore({ adapter: new FakeModelAdapter(), storage });
  return { api, storage };
}

describe("素材库与通话列表", () => {
  it("listMaterials 返回已分析的素材,getMaterial 按 id 取回", async () => {
    const { api } = setup();
    const created = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    const list = await api.listMaterials();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
    expect(await api.getMaterial(created.id)).toMatchObject({ id: created.id, title: created.title });
  });

  it("getMaterial 对不存在的 id 抛错", async () => {
    const { api } = setup();
    await expect(api.getMaterial("missing")).rejects.toThrow("素材不存在");
  });

  it("listConversations 按创建时间倒序返回全部通话", async () => {
    const { api } = setup();
    const first = await api.startConversation(SEED_PERSONAS[0]!.id);
    // ISO 时间戳为毫秒精度:同毫秒创建的两通通话只能靠次级键(无法预测),
    // 隔开时间让「后创建在前」的断言确定成立。
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await api.startConversation(SEED_PERSONAS[1]!.id);
    const list = await api.listConversations();
    expect(list.map((c) => c.id)).toEqual([second.id, first.id]);
  });
});

describe("素材类型", () => {
  it("分析时可写入合法类型,缺省保持未分类", async () => {
    const { api } = setup();
    const unclassified = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    expect(unclassified.kind).toBeUndefined();

    const typed = await api.analyzeTranscript({
      transcript: SEED_TRANSCRIPT,
      kind: "软拒绝",
    });
    expect(typed.kind).toBe("软拒绝");
    expect(MATERIAL_KINDS).toContain("软拒绝");
  });

  it("非法类型拒绝入库", async () => {
    const { api } = setup();
    await expect(
      api.analyzeTranscript({
        transcript: SEED_TRANSCRIPT,
        kind: "未知类型" as "顺利沟通",
      }),
    ).rejects.toThrow("素材类型不合法");
  });

  it("草稿可补写类型;旧数据缺字段保持未分类", async () => {
    const { api, storage } = setup();
    const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    expect(material.kind).toBeUndefined();

    const updated = await api.updateMaterialDraft(material.id, { kind: "明确拒绝" });
    expect(updated.kind).toBe("明确拒绝");

    const seed = buildSeedMaterial();
    expect(seed.kind).toBe("顺利沟通");

    await storage.saveMaterial({
      ...seed,
      id: "legacy",
      createdAt: new Date().toISOString(),
      kind: undefined,
    });
    const legacy = await api.getMaterial("legacy");
    expect(legacy.kind).toBeUndefined();
  });
});
