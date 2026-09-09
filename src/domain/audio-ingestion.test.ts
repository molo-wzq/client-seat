import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { createInProcessProductApi } from "../product/in-process-product-api";
import { MAX_AUDIO_BYTES } from "./product-core";

describe("优秀录音摄入", () => {
  it("把支持格式的单段录音转成待校对文字,不创建素材或保存录音", async () => {
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });

    const result = await api.transcribeAudio({
      fileName: "优秀案例.m4a",
      mediaType: "audio/mp4",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.transcript).toContain("T01 经理:");
    expect(result.transcript).toContain("T02 客户:");
    expect(await api.listMaterials()).toEqual([]);
  });

  it("转写文字沿用现有分析、发布与新对话闭环", async () => {
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });
    const { transcript } = await api.transcribeAudio({
      fileName: "new-call.mp3",
      mediaType: "audio/mpeg",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const material = await api.analyzeTranscript({ title: "new-call", transcript, kind: "顺利沟通" });
    await api.publishMaterialCards(material.id);
    const conversation = await api.startConversation("p01-daifagua");
    const progressed = await api.sendCustomerTurn(conversation.id, "喂");

    expect(progressed.turns.some((turn) => turn.speaker === "manager")).toBe(true);
    expect((await api.getMaterial(material.id)).cards.every((card) => card.status === "published")).toBe(true);
  });

  it("拒绝不支持的格式、空文件和超过 25MB 的录音", async () => {
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });
    await expect(
      api.transcribeAudio({ fileName: "call.txt", mediaType: "text/plain", bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/格式不支持/);
    await expect(
      api.transcribeAudio({ fileName: "call.mp3", mediaType: "audio/mpeg", bytes: new Uint8Array() }),
    ).rejects.toThrow(/文件为空/);
    await expect(
      api.transcribeAudio({
        fileName: "call.wav",
        mediaType: "audio/wav",
        bytes: new Uint8Array(MAX_AUDIO_BYTES + 1),
      }),
    ).rejects.toThrow(/25MB/);
  });
});
