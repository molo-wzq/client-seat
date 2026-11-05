import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME } from "../src/adapters/openai-model-adapter";
import { DEFAULT_ASR_MODEL } from "./audio-transcriber";
import { readAgentRouterConfig, readAgentWorkerConfig, readAsrConfig, readLlmConfig } from "./model-config";

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

describe("Agent 分组(工单 11:Router 轻量 / Worker 强模型)", () => {
  const ROUTER_FULL = {
    AGENT_ROUTER_API_KEY: "router-key",
    AGENT_ROUTER_BASE_URL: "https://router.example.com/v1",
    AGENT_ROUTER_MODEL: "router-model",
  };
  const WORKER_FULL = {
    AGENT_WORKER_API_KEY: "worker-key",
    AGENT_WORKER_BASE_URL: "https://worker.example.com/v1",
    AGENT_WORKER_MODEL: "worker-model",
  };

  it("Agent 两组各自填满时完全独立,不回退 LLM 组", () => {
    expect(readAgentRouterConfig({ ...LLM_FULL, ...ROUTER_FULL })).toEqual({
      apiKey: "router-key",
      baseUrl: "https://router.example.com/v1",
      model: "router-model",
    });
    expect(readAgentWorkerConfig({ ...LLM_FULL, ...WORKER_FULL })).toEqual({
      apiKey: "worker-key",
      baseUrl: "https://worker.example.com/v1",
      model: "worker-model",
    });
  });

  it("Agent 组完全未配时,密钥地址模型沿用现有 LLM 组", () => {
    expect(readAgentRouterConfig(LLM_FULL)).toEqual({
      apiKey: "llm-key",
      baseUrl: "https://llm.example.com/v1",
      model: "llm-model",
    });
    expect(readAgentWorkerConfig(LLM_FULL)).toEqual({
      apiKey: "llm-key",
      baseUrl: "https://llm.example.com/v1",
      model: "llm-model",
    });
  });

  it("Agent 组只配密钥时,地址与模型仍回退 LLM 组(同一供应商只配一组即可)", () => {
    expect(readAgentWorkerConfig({ ...LLM_FULL, AGENT_WORKER_API_KEY: "worker-key" })).toEqual({
      apiKey: "worker-key",
      baseUrl: "https://llm.example.com/v1",
      model: "llm-model",
    });
    expect(readAgentRouterConfig({ ...LLM_FULL, AGENT_ROUTER_API_KEY: "router-key" })).toEqual({
      apiKey: "router-key",
      baseUrl: "https://llm.example.com/v1",
      model: "llm-model",
    });
  });

  it("Agent 组与 LLM 组都没配密钥:密钥为 undefined(调用方退回 demo),地址模型落默认", () => {
    expect(readAgentRouterConfig({})).toEqual({
      apiKey: undefined,
      baseUrl: DEFAULT_MODEL_BASE_URL,
      model: DEFAULT_MODEL_NAME,
    });
    expect(readAgentWorkerConfig({})).toEqual({
      apiKey: undefined,
      baseUrl: DEFAULT_MODEL_BASE_URL,
      model: DEFAULT_MODEL_NAME,
    });
  });
});
