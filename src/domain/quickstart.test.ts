import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { createInProcessProductApi, InMemoryStorage } from "../product/in-process-product-api";
import { SEED_CARD_IDS, SEED_MATERIAL_TITLE, SEED_PERSONAS, SEED_TRANSCRIPT } from "./seed";

function setup() {
  const storage = new InMemoryStorage();
  const api = createInProcessProductApi({ adapter: new FakeModelAdapter(), storage });
  return { api, storage };
}

describe("快速开始", () => {
  it("空库时以已发布态入库种子素材,用第一个内置画像直接开会话", async () => {
    const { api, storage } = setup();
    const conversation = await api.quickStart();

    expect(conversation.status).toBe("ongoing");
    expect(conversation.personaId).toBe(SEED_PERSONAS[0]?.id);

    const materials = await storage.listMaterials();
    expect(materials).toHaveLength(1);
    expect(materials[0]?.title).toBe(SEED_MATERIAL_TITLE);
    expect(materials[0]?.cards.every((c) => c.status === "published")).toBe(true);

    // 种子卡真实驱动对话:开场引用生客开场卡。
    const after = await api.sendCustomerTurn(conversation.id, "喂");
    expect(after.turns[1]?.usedCardId).toBe(SEED_CARD_IDS.opening);
  });

  it("重复调用幂等:不重复入库种子素材", async () => {
    const { api, storage } = setup();
    await api.quickStart();
    await api.quickStart();

    const materials = await storage.listMaterials();
    expect(materials.filter((m) => m.title === SEED_MATERIAL_TITLE)).toHaveLength(1);
  });

  it("已有已发布卡时不入库种子素材", async () => {
    const { api, storage } = setup();
    const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    await api.publishMaterialCards(material.id);

    await api.quickStart();

    const materials = await storage.listMaterials();
    expect(materials).toHaveLength(1);
    expect(materials[0]?.id).toBe(material.id);
  });

  it("种子素材在库但卡未发布时,发布其草稿卡", async () => {
    const { api, storage } = setup();
    // 构造种子标题素材但保持草稿态(模拟旧数据)。
    const material = await api.analyzeTranscript({
      title: SEED_MATERIAL_TITLE,
      transcript: SEED_TRANSCRIPT,
    });
    // 通过另起空库存的 api 不行——同一 storage 下 analyze 会生成草稿,无已发布卡。
    const conversation = await api.quickStart();

    const saved = await storage.getMaterial(material.id);
    expect(saved?.cards.every((c) => c.status === "published")).toBe(true);
    expect(conversation.status).toBe("ongoing");
  });
});
