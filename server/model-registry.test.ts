import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME } from "../src/adapters/openai-model-adapter";
import { DEFAULT_ASR_MODEL } from "./audio-transcriber";
import { formatRegistrySummary, MODEL_ROLES, resolveModelRegistry, type ModelsConfig } from "./model-registry";

const LLM_ENV = {
  MIMO_API_KEY: "llm-key",
  MIMO_BASE_URL: "https://llm.example.com/v1",
  MIMO_MODEL: "llm-model",
};

const FALLBACK_ENV = {
  LLM_FALLBACK_API_KEY: "fb-key",
  LLM_FALLBACK_BASE_URL: "https://fb.example.com/v1",
  LLM_FALLBACK_MODEL: "fb-model",
};

describe("多模型注册表(工单 13):旧环境变量映射为默认 provider", () => {
  it("LLM 组 + LLM_FALLBACK_*:manager/judge/copywriting 主链 mimo,备用作第二链项", () => {
    const registry = resolveModelRegistry({ env: { ...LLM_ENV, ...FALLBACK_ENV } });
    const expected = [
      { providerId: "mimo", model: "llm-model", baseUrl: "https://llm.example.com/v1", apiKey: "llm-key", protocol: "openai-chat" },
      { providerId: "llm-fallback", model: "fb-model", baseUrl: "https://fb.example.com/v1", apiKey: "fb-key", protocol: "openai-chat" },
    ];
    expect(registry.roles.manager).toEqual(expected);
    expect(registry.roles.judge).toEqual(expected);
    expect(registry.roles.copywriting).toEqual(expected);
  });

  it("只配主组无备用:链只有一项;只配备用无主组:备用作唯一链项(现状行为)", () => {
    expect(resolveModelRegistry({ env: LLM_ENV }).roles.manager).toHaveLength(1);
    const onlyFallback = resolveModelRegistry({ env: FALLBACK_ENV });
    expect(onlyFallback.roles.manager.map((entry) => entry.providerId)).toEqual(["llm-fallback"]);
  });

  it("ASR 组独立时走 asr provider;未配时回退 LLM 组,模型用转写默认(与 readAsrConfig 一致)", () => {
    const standalone = resolveModelRegistry({
      env: { ...LLM_ENV, ASR_API_KEY: "asr-key", ASR_BASE_URL: "https://asr.example.com/v1", ASR_MODEL: "asr-model" },
    });
    expect(standalone.roles.asr).toEqual([
      { providerId: "asr", model: "asr-model", baseUrl: "https://asr.example.com/v1", apiKey: "asr-key", protocol: "openai-chat" },
    ]);
    const shared = resolveModelRegistry({ env: LLM_ENV }).roles.asr;
    expect(shared).toEqual([
      { providerId: "asr", model: DEFAULT_ASR_MODEL, baseUrl: "https://llm.example.com/v1", apiKey: "llm-key", protocol: "openai-chat" },
    ]);
  });

  it("AGENT_* 两组映射 agent.router/agent.chat/agent.worker;未配回退 LLM 组(mimo provider)", () => {
    const registry = resolveModelRegistry({
      env: {
        ...LLM_ENV,
        AGENT_WORKER_API_KEY: "w-key",
        AGENT_WORKER_BASE_URL: "https://worker.example.com/v1",
        AGENT_WORKER_MODEL: "w-model",
      },
    });
    expect(registry.roles["agent.worker"]).toEqual([
      { providerId: "agent-worker", model: "w-model", baseUrl: "https://worker.example.com/v1", apiKey: "w-key", protocol: "openai-chat" },
    ]);
    expect(registry.roles["agent.router"]).toEqual([
      { providerId: "mimo", model: "llm-model", baseUrl: "https://llm.example.com/v1", apiKey: "llm-key", protocol: "openai-chat" },
    ]);
    expect(registry.roles["agent.chat"]).toEqual(registry.roles["agent.router"]);
  });

  it("全部未配:所有角色链为空(demo 模式),mimo provider 落代码默认值", () => {
    const registry = resolveModelRegistry({ env: {} });
    for (const role of MODEL_ROLES) {
      expect(registry.roles[role]).toEqual([]);
    }
    const mimo = registry.providers.find((provider) => provider.id === "mimo");
    expect(mimo?.baseUrl).toBe(DEFAULT_MODEL_BASE_URL);
    expect(mimo?.models).toEqual([DEFAULT_MODEL_NAME]);
  });
});

const FILE_ENV = {
  ZHIPU_API_KEY: "zhipu-key",
  DEEPSEEK_API_KEY: "ds-key",
  ...LLM_ENV,
};

const FILE_PROVIDERS = [
  {
    id: "zhipu",
    protocol: "openai-chat",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
    models: ["glm-4.6", "glm-4.6-air"],
    capabilities: { stream: true, tools: true, json: true, audio: false },
  },
  {
    id: "deepseek",
    protocol: "openai-chat",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat"],
    capabilities: { stream: true, tools: true, json: true, audio: false },
  },
];

const GLM_DEEPSEEK_CONFIG: ModelsConfig = {
  providers: FILE_PROVIDERS,
  roles: {
    manager: ["zhipu:glm-4.6", "deepseek:deepseek-chat"],
    judge: "deepseek:deepseek-chat",
    "agent.chat": "zhipu:glm-4.6-air",
  },
};

describe("多模型注册表(工单 13):models.config.json 的 providers 与 roles", () => {
  it("文件角色优先:链序保持;未配置的角色沿用环境变量映射", () => {
    const registry = resolveModelRegistry({ config: GLM_DEEPSEEK_CONFIG, env: FILE_ENV });
    expect(registry.roles.manager).toEqual([
      { providerId: "zhipu", model: "glm-4.6", protocol: "openai-chat", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "zhipu-key" },
      { providerId: "deepseek", model: "deepseek-chat", protocol: "openai-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "ds-key" },
    ]);
    expect(registry.roles.judge).toEqual([
      { providerId: "deepseek", model: "deepseek-chat", protocol: "openai-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "ds-key" },
    ]);
    expect(registry.roles["agent.chat"]).toEqual([
      { providerId: "zhipu", model: "glm-4.6-air", protocol: "openai-chat", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "zhipu-key" },
    ]);
    // 未写进文件的角色照旧走旧变量:copywriting 仍是 mimo。
    expect(registry.roles.copywriting).toEqual([
      { providerId: "mimo", model: "llm-model", protocol: "openai-chat", baseUrl: "https://llm.example.com/v1", apiKey: "llm-key" },
    ]);
    expect(registry.providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(["mimo", "zhipu", "deepseek"]),
    );
  });

  it("角色引用未知 provider 或 provider 未登记的模型 → 报错指明角色与引用", () => {
    expect(() =>
      resolveModelRegistry({
        config: { ...GLM_DEEPSEEK_CONFIG, roles: { manager: "nope:glm-4.6" } },
        env: FILE_ENV,
      }),
    ).toThrow(/manager.*nope/);
    expect(() =>
      resolveModelRegistry({
        config: { ...GLM_DEEPSEEK_CONFIG, roles: { manager: "zhipu:not-registered" } },
        env: FILE_ENV,
      }),
    ).toThrow(/zhipu.*not-registered/);
  });

  it("未知角色名或 provider id 重复 → 报错", () => {
    expect(() =>
      resolveModelRegistry({ config: { ...GLM_DEEPSEEK_CONFIG, roles: { pirate: "zhipu:glm-4.6" } }, env: FILE_ENV }),
    ).toThrow(/pirate/);
    expect(() =>
      resolveModelRegistry({
        config: { providers: [...FILE_PROVIDERS, FILE_PROVIDERS[0]] },
        env: FILE_ENV,
      }),
    ).toThrow(/zhipu/);
  });

  it("文件 provider 指定的密钥环境变量未设置 → 启动即报错,不静默降级", () => {
    expect(() => resolveModelRegistry({ config: GLM_DEEPSEEK_CONFIG, env: { ...FILE_ENV, ZHIPU_API_KEY: undefined } })).toThrow(
      /ZHIPU_API_KEY/,
    );
  });
});

describe("多模型注册表(工单 13):能力与协议校验", () => {
  const NO_STREAM_PROVIDER = {
    id: "zhipu",
    protocol: "openai-chat",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
    models: ["glm-4.6-air"],
    capabilities: { stream: false, tools: true, json: true, audio: false },
  };

  it("能力不匹配直接报错:agent.chat 要求 stream", () => {
    expect(() =>
      resolveModelRegistry({
        config: { providers: [NO_STREAM_PROVIDER], roles: { "agent.chat": "zhipu:glm-4.6-air" } },
        env: FILE_ENV,
      }),
    ).toThrow(/agent\.chat 要求能力 stream/);
  });

  it("能力不匹配直接报错:asr 要求 audio", () => {
    expect(() =>
      resolveModelRegistry({
        config: { providers: [NO_STREAM_PROVIDER], roles: { asr: "zhipu:glm-4.6-air" } },
        env: FILE_ENV,
      }),
    ).toThrow(/asr 要求能力 audio/);
  });

  it("anthropic-messages:角色引用时报明确的未实现错误;只登记不引用不报错(接口预留)", () => {
    const anthropic = {
      id: "claude",
      protocol: "anthropic-messages",
      baseUrl: "https://api.example.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      models: ["claude-x"],
      capabilities: { stream: true, tools: true, json: true, audio: false },
    };
    expect(() =>
      resolveModelRegistry({
        config: { providers: [anthropic], roles: { manager: "claude:claude-x" } },
        env: { ANTHROPIC_API_KEY: "anthropic-key" },
      }),
    ).toThrow(/anthropic-messages 尚未实现/);
    expect(() =>
      resolveModelRegistry({
        config: { providers: [FILE_PROVIDERS[0], anthropic] },
        env: { ...FILE_ENV, ANTHROPIC_API_KEY: "anthropic-key" },
      }),
    ).not.toThrow();
  });
});

describe("启动摘要(工单 13):逐角色打印实际 provider:model,不含密钥", () => {
  it("打印每个角色的 fallback 链(→ 分隔);任何密钥都不出现在摘要里", () => {
    const registry = resolveModelRegistry({
      config: GLM_DEEPSEEK_CONFIG,
      env: { ...FILE_ENV, ...FALLBACK_ENV },
    });
    const summary = formatRegistrySummary(registry);
    expect(summary).toContain("manager: zhipu/glm-4.6 → deepseek/deepseek-chat");
    expect(summary).toContain("judge: deepseek/deepseek-chat");
    expect(summary).toContain("copywriting: mimo/llm-model → llm-fallback/fb-model");
    expect(summary).toContain("agent.chat: zhipu/glm-4.6-air");
    for (const secret of ["zhipu-key", "ds-key", "llm-key", "fb-key"]) {
      expect(summary).not.toContain(secret);
    }
  });

  it("角色链为空时标 demo(未配密钥)", () => {
    const summary = formatRegistrySummary(resolveModelRegistry({ env: {} }));
    expect(summary).toContain("manager: demo(未配密钥)");
    expect(summary).toContain("agent.chat: demo(未配密钥)");
  });
});
