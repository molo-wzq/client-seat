import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME } from "../src/adapters/openai-model-adapter";
import { DEFAULT_ASR_MODEL } from "./audio-transcriber";
import { readAsrConfig, readLlmConfig } from "./model-config";

const LLM_FULL = {
  MIMO_API_KEY: "llm-key",
  MIMO_BASE_URL: "https://llm.example.com/v1",
  MIMO_MODEL: "llm-model",
};

const ASR_FULL = {
  ASR_API_KEY: "asr-key",
  ASR_BASE_URL: "https://asr.example.com/v1",
  ASR_MODEL: "asr-model",
};

describe("模型配置解析(票 25)", () => {
  it("LLM 组:填满时原样返回;全空时密钥为空、其余落默认值", () => {
    expect(readLlmConfig(LLM_FULL)).toEqual({
      apiKey: "llm-key",
      baseUrl: "https://llm.example.com/v1",
      model: "llm-model",
    });
    const empty = readLlmConfig({});
    expect(empty.apiKey).toBeUndefined();
    expect(empty.baseUrl).toBe(DEFAULT_MODEL_BASE_URL);
    expect(empty.model).toBe(DEFAULT_MODEL_NAME);
  });

  it("只配 LLM 组时,ASR 复用其密钥与地址,模型用转写默认(现状行为不变)", () => {
    const asr = readAsrConfig(LLM_FULL);
    expect(asr).toEqual({
      apiKey: "llm-key",
      baseUrl: "https://llm.example.com/v1",
      model: DEFAULT_ASR_MODEL,
    });
  });

  it("ASR 组填满时完全独立,不回退到 LLM 组", () => {
    expect(readAsrConfig({ ...ASR_FULL, ...LLM_FULL })).toEqual({
      apiKey: "asr-key",
      baseUrl: "https://asr.example.com/v1",
      model: "asr-model",
    });
  });

  it("ASR 只填 model 时,密钥与地址仍回退 LLM 组", () => {
    const asr = readAsrConfig({ ...LLM_FULL, ASR_MODEL: "asr-model" });
    expect(asr).toEqual({
      apiKey: "llm-key",
      baseUrl: "https://llm.example.com/v1",
      model: "asr-model",
    });
  });

  it("历史变量 MIMO_ASR_MODEL 仍生效,优先级低于 ASR_MODEL", () => {
    expect(readAsrConfig({ ...LLM_FULL, MIMO_ASR_MODEL: "old-asr" }).model).toBe("old-asr");
    expect(readAsrConfig({ ...LLM_FULL, MIMO_ASR_MODEL: "old-asr", ASR_MODEL: "new-asr" }).model).toBe(
      "new-asr",
    );
  });

  it("全部未配:ASR 密钥为空,地址与模型落默认", () => {
    const asr = readAsrConfig({});
    expect(asr.apiKey).toBeUndefined();
    expect(asr.baseUrl).toBe(DEFAULT_MODEL_BASE_URL);
    expect(asr.model).toBe(DEFAULT_ASR_MODEL);
  });
});
