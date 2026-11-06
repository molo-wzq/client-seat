import fs from "node:fs";
import path from "node:path";
import {
  ASR_CONFIG_ENV,
  LLM_CONFIG_ENV,
  readAsrConfig,
  readLlmConfig,
  readLlmFallbackConfig,
  type Env,
  type ResolvedModelConfig,
} from "./model-config";

/**
 * 多模型注册表(工单 13):按「角色」选模型,可接多供应商。
 * - providers:仓库根目录可选的 models.config.json 登记 { id, protocol, baseUrl,
 *   apiKeyEnv, models[], capabilities }——密钥只从环境变量读,绝不写进文件;
 * - roles:manager/judge/copywriting/asr/agent.router/agent.worker/agent.chat,
 *   每个角色一条有序 fallback 链("providerId:model" 数组);
 * - judge 未显式配置时不自成链(S6):不注入裁判,链上各项自裁——裁判跟着
 *   本次实际出话的模型走,主模型挂掉不会再请求它;
 * - agent.chat 未配置时继承 agent.router 的链(S7);
 * - 兼容:没写 models.config.json 或角色未在文件里配置时,沿用旧
 *   MIMO_* / ASR_* / LLM_FALLBACK_* / AGENT_* 环境变量(映射成默认 provider,
 *   Agent 分组读取在本文件内),旧 .env.local 一个字都不用改。
 * resolveModelRegistry 是纯函数:配置错误(能力不匹配、引用未知 provider、
 * anthropic-messages 未实现)直接抛错,由组合根按启动失败处理。
 */

/** 角色表:注册表支持的全部角色(工单 13)。 */
export const MODEL_ROLES = [
  "manager",
  "judge",
  "copywriting",
  "asr",
  "agent.router",
  "agent.worker",
  "agent.chat",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/** 协议:本期只实现 openai-chat;anthropic-messages 只留接口与明确报错。 */
export type ModelProtocol = "openai-chat" | "anthropic-messages";

export interface ProviderCapabilities {
  stream: boolean;
  tools: boolean;
  json: boolean;
  audio: boolean;
}

export interface ModelProvider {
  id: string;
  protocol: ModelProtocol;
  baseUrl: string;
  /** 密钥环境变量名:密钥只在服务端 env 读取,不落 models.config.json。 */
  apiKeyEnv: string;
  models: string[];
  capabilities: ProviderCapabilities;
}

/** 角色链上的一项:provider + 模型 + 解析出的接入参数。 */
export interface RoleModelEntry {
  providerId: string;
  model: string;
  protocol: ModelProtocol;
  baseUrl: string;
  apiKey: string | undefined;
}

export interface ResolvedModelRegistry {
  providers: ModelProvider[];
  roles: Record<ModelRole, RoleModelEntry[]>;
}

/** models.config.json 的形状(解析前的原始 JSON,逐字段校验)。 */
export interface ModelsConfig {
  providers?: unknown;
  roles?: unknown;
}

/** 各角色对 provider 能力的硬要求:不满足直接报错(例:agent.chat 要求 stream)。 */
const ROLE_REQUIRED_CAPABILITIES: Record<ModelRole, Array<keyof ProviderCapabilities>> = {
  manager: ["stream"],
  judge: ["json"],
  copywriting: ["json"],
  asr: ["audio"],
  "agent.router": ["stream"],
  "agent.worker": ["stream"],
  "agent.chat": ["stream"],
};

/** 环境变量合成 provider 的默认能力:网关走 OpenAI 兼容协议,流式/工具/JSON 都在。 */
const OPENAI_CHAT_CAPABILITIES: ProviderCapabilities = { stream: true, tools: true, json: true, audio: false };

/**
 * Agent 分组环境变量(工单 11;读取原 model-config 的 Agent 函数并入此处):
 * AGENT_ROUTER_* 用轻量模型(分派与说话),AGENT_WORKER_* 用强模型(投研、盲区等
 * 重活),两组独立配置;未填字段回退 LLM 组——LLM 也没配密钥时链为空(退回 demo)。
 */
const AGENT_GROUP_ENV = {
  router: { key: "AGENT_ROUTER_API_KEY", baseUrl: "AGENT_ROUTER_BASE_URL", model: "AGENT_ROUTER_MODEL" },
  worker: { key: "AGENT_WORKER_API_KEY", baseUrl: "AGENT_WORKER_BASE_URL", model: "AGENT_WORKER_MODEL" },
} as const;

/**
 * 旧环境变量 → 默认 provider + 角色链(工单 13 兼容层)。
 * 分组语义复用 model-config 的既有读法,保证旧 .env.local 行为逐字段一致;
 * 没配密钥的链项直接剔除(角色链为空 = 调用方退回 demo)。
 * judge 例外(S6):未显式配置即空链,不注入裁判。
 */
function resolveLegacyRoles(env: Env): { providers: ModelProvider[]; roles: Record<ModelRole, RoleModelEntry[]> } {
  const llm = readLlmConfig(env);
  const llmFallback = readLlmFallbackConfig(env);
  const asr = readAsrConfig(env);

  const mimo: ModelProvider = {
    id: "mimo",
    protocol: "openai-chat",
    baseUrl: llm.baseUrl,
    apiKeyEnv: "MIMO_API_KEY",
    models: [llm.model],
    // 同一网关也承载转写回退(ASR 未独立配置时),audio 算在能力内。
    capabilities: { ...OPENAI_CHAT_CAPABILITIES, audio: true },
  };
  const providers: ModelProvider[] = [mimo];

  const main = llm.apiKey
    ? [{ providerId: mimo.id, model: llm.model, protocol: mimo.protocol, baseUrl: llm.baseUrl, apiKey: llm.apiKey }]
    : [];
  let llmChain = main;
  if (llmFallback.apiKey) {
    const fbProvider: ModelProvider = {
      id: "llm-fallback",
      protocol: "openai-chat",
      baseUrl: llmFallback.baseUrl,
      apiKeyEnv: "LLM_FALLBACK_API_KEY",
      models: [llmFallback.model],
      capabilities: { ...OPENAI_CHAT_CAPABILITIES, audio: true },
    };
    providers.push(fbProvider);
    llmChain = [
      ...main,
      { providerId: fbProvider.id, model: llmFallback.model, protocol: fbProvider.protocol, baseUrl: llmFallback.baseUrl, apiKey: llmFallback.apiKey },
    ];
  }

  // ASR:始终合成独立 asr provider(未配 ASR_* 时密钥地址即 LLM 组的,模型用转写默认)。
  // apiKeyEnv 记录实际取 key 的变量(S7):回退 LLM 组时指 MIMO_API_KEY,
  // 文件引用该 provider 时按真实来源查密钥,不再误报未设置。
  const asrProvider: ModelProvider = {
    id: "asr",
    protocol: "openai-chat",
    baseUrl: asr.baseUrl,
    apiKeyEnv: env[ASR_CONFIG_ENV.key] ? ASR_CONFIG_ENV.key : LLM_CONFIG_ENV.key,
    models: [asr.model],
    capabilities: { stream: false, tools: false, json: false, audio: true },
  };
  providers.push(asrProvider);
  const asrEntry = asr.apiKey
    ? [{ providerId: asrProvider.id, model: asr.model, protocol: asrProvider.protocol, baseUrl: asr.baseUrl, apiKey: asr.apiKey }]
    : [];

  // Agent 两组:AGENT_*_BASE_URL/_MODEL/_API_KEY 任一出现即合成独立 provider,
  // 否则与 LLM 组同值、直接挂到 mimo provider 上(工单 11 回退语义)。
  const routerEntry = agentChain(env, AGENT_GROUP_ENV.router, "agent-router", llm, mimo, providers);
  const workerEntry = agentChain(env, AGENT_GROUP_ENV.worker, "agent-worker", llm, mimo, providers);

  return {
    providers,
    roles: {
      manager: [...llmChain],
      // judge 未显式配置不成链(S6):组合根不注入裁判,manager 链上各项自裁。
      judge: [],
      copywriting: [...llmChain],
      asr: asrEntry,
      "agent.router": routerEntry,
      "agent.worker": workerEntry,
      "agent.chat": [...routerEntry],
    },
  };
}

/**
 * Agent 分组合成:配置了 AGENT_* 独立组则建独立 provider,否则挂回 mimo。
 * apiKeyEnv 记录实际取 key 的变量(S7):密钥回退 LLM 组时写 MIMO_API_KEY。
 */
function agentChain(
  env: Env,
  group: { readonly key: string; readonly baseUrl: string; readonly model: string },
  providerId: "agent-router" | "agent-worker",
  llm: ResolvedModelConfig,
  mimo: ModelProvider,
  providers: ModelProvider[],
): RoleModelEntry[] {
  const apiKey = env[group.key] || llm.apiKey;
  if (!apiKey) return [];
  const baseUrl = env[group.baseUrl] || llm.baseUrl;
  const model = env[group.model] || llm.model;
  const configured = Boolean(env[group.key] || env[group.baseUrl] || env[group.model]);
  const provider: ModelProvider = configured
    ? {
        id: providerId,
        protocol: "openai-chat",
        baseUrl,
        apiKeyEnv: env[group.key] ? group.key : LLM_CONFIG_ENV.key,
        models: [model],
        capabilities: OPENAI_CHAT_CAPABILITIES,
      }
    : mimo;
  if (configured) providers.push(provider);
  return [{ providerId: provider.id, model, protocol: provider.protocol, baseUrl, apiKey }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`models.config.json:${where} 缺少合法的 ${field}(非空字符串)`);
  }
  return value.trim();
}

/** 解析并校验文件 providers:字段齐全、id 不重复、协议只认两个枚举值。 */
function parseFileProviders(raw: unknown): ModelProvider[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("models.config.json 的 providers 需为数组");
  const providers: ModelProvider[] = [];
  for (const item of raw) {
    if (!isRecord(item)) throw new Error("models.config.json 的 provider 需为对象");
    const id = requireString(item, "id", "provider");
    if (providers.some((provider) => provider.id === id)) {
      throw new Error(`models.config.json:provider id 重复:${id}`);
    }
    const protocol = item.protocol;
    if (protocol !== "openai-chat" && protocol !== "anthropic-messages") {
      throw new Error(`models.config.json:provider ${id} 的 protocol 需为 openai-chat 或 anthropic-messages`);
    }
    const capabilitiesRaw = isRecord(item.capabilities) ? item.capabilities : {};
    const capability = (name: keyof ProviderCapabilities): boolean => capabilitiesRaw[name] === true;
    const modelsRaw = item.models;
    if (!Array.isArray(modelsRaw) || modelsRaw.length === 0 || modelsRaw.some((model) => typeof model !== "string" || !model.trim())) {
      throw new Error(`models.config.json:provider ${id} 的 models 需为非空字符串数组`);
    }
    providers.push({
      id,
      protocol,
      baseUrl: requireString(item, "baseUrl", `provider ${id}`),
      apiKeyEnv: requireString(item, "apiKeyEnv", `provider ${id}`),
      models: modelsRaw.map((model) => (model as string).trim()),
      capabilities: { stream: capability("stream"), tools: capability("tools"), json: capability("json"), audio: capability("audio") },
    });
  }
  return providers;
}

/**
 * 解析文件 roles:每个角色一条 "providerId:model" 有序链(单值按一项链)。
 * 引用校验:provider 存在、模型已登记(环境变量合成的 provider 免登记校验)、
 * 协议 anthropic-messages 尚未实现、能力满足角色硬要求、密钥环境变量已设置。
 */
function parseFileRoles(
  raw: unknown,
  env: Env,
  fileProviders: ModelProvider[],
  legacyProviders: ModelProvider[],
): Record<ModelRole, RoleModelEntry[]> {
  if (raw === undefined) return {} as Record<ModelRole, RoleModelEntry[]>;
  if (!isRecord(raw)) throw new Error("models.config.json 的 roles 需为对象");
  const allProviders = [...fileProviders, ...legacyProviders];
  const roles = {} as Record<ModelRole, RoleModelEntry[]>;
  for (const role of Object.keys(raw)) {
    if (!MODEL_ROLES.includes(role as ModelRole)) {
      throw new Error(`models.config.json:未知角色 ${role}(支持:${MODEL_ROLES.join("、 ")})`);
    }
    const refs = Array.isArray(raw[role]) ? (raw[role] as unknown[]) : [raw[role]];
    if (refs.length === 0) throw new Error(`models.config.json:角色 ${role} 的模型链为空`);
    const entries: RoleModelEntry[] = refs.map((ref, index) => {
      if (typeof ref !== "string" || !ref.includes(":")) {
        throw new Error(`models.config.json:角色 ${role} 第 ${index + 1} 项需为 "providerId:model",实际是 ${String(ref)}`);
      }
      const separator = ref.indexOf(":");
      const providerId = ref.slice(0, separator);
      const model = ref.slice(separator + 1).trim();
      const provider = allProviders.find((candidate) => candidate.id === providerId);
      if (!provider) throw new Error(`models.config.json:角色 ${role} 引用了未登记的 provider ${providerId}`);
      if (fileProviders.includes(provider) && !provider.models.includes(model)) {
        throw new Error(`models.config.json:provider ${providerId} 未登记模型 ${model}(已登记:${provider.models.join("、")})`);
      }
      if (provider.protocol === "anthropic-messages") {
        throw new Error(`models.config.json:角色 ${role} 的 ${providerId} 使用协议 anthropic-messages 尚未实现(本期只支持 openai-chat)`);
      }
      for (const capability of ROLE_REQUIRED_CAPABILITIES[role as ModelRole]) {
        if (!provider.capabilities[capability]) {
          throw new Error(`models.config.json:角色 ${role} 要求能力 ${capability},provider ${providerId} 未声明(第 ${index + 1} 项:${ref})`);
        }
      }
      const apiKey = env[provider.apiKeyEnv];
      if (!apiKey) {
        throw new Error(`models.config.json:角色 ${role} 的 provider ${providerId} 密钥未设置(需环境变量 ${provider.apiKeyEnv})`);
      }
      return { providerId, model, protocol: provider.protocol, baseUrl: provider.baseUrl, apiKey };
    });
    roles[role as ModelRole] = entries;
  }
  return roles;
}

/**
 * 解析注册表:models.config.json(可选)+ 环境变量 → providers 与各角色 fallback 链。
 * 纯函数:文件角色优先,未在文件里配置的角色沿用旧环境变量映射(链项无密钥即剔除)。
 */
export function resolveModelRegistry(deps: { config?: ModelsConfig | undefined; env: Env }): ResolvedModelRegistry {
  const legacy = resolveLegacyRoles(deps.env);
  if (deps.config === undefined) return { providers: legacy.providers, roles: legacy.roles };
  const fileProviders = parseFileProviders(deps.config.providers);
  const fileRoles = parseFileRoles(deps.config.roles, deps.env, fileProviders, legacy.providers);
  // agent.chat 缺省继承文件里的 agent.router(S7):文件只配 agent.router 时也要
  // 真正生效——继承要发生在覆盖 legacy 之前,否则会被旧变量的 agent.chat 盖回去。
  if (!fileRoles["agent.chat"] && fileRoles["agent.router"]) fileRoles["agent.chat"] = fileRoles["agent.router"];
  return {
    providers: [...legacy.providers, ...fileProviders],
    roles: { ...legacy.roles, ...fileRoles },
  };
}

/**
 * 启动摘要:每个角色实际用的 provider:model 链(→ 分隔),空链标 demo;
 * judge 空链不是 demo——它跟 manager 链上各项自裁(S6)。
 * 只拼 providerId 与模型名,绝不拼密钥(工单 13)。
 */
export function formatRegistrySummary(registry: ResolvedModelRegistry): string {
  return MODEL_ROLES.map((role) => {
    const chain = registry.roles[role];
    const label =
      role === "judge" && chain.length === 0
        ? "跟随 manager 链(各项自裁)"
        : chain.length === 0
          ? "demo(未配密钥)"
          : chain.map((entry) => `${entry.providerId}/${entry.model}`).join(" → ");
    return `${role}: ${label}`;
  }).join("\n");
}

/** 读仓库根目录的 models.config.json(可选文件);不存在返回 undefined,坏 JSON 直接抛错。 */
export function readModelsConfigFile(root: string): ModelsConfig | undefined {
  const file = path.join(root, "models.config.json");
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ModelsConfig;
  } catch (error) {
    throw new Error(`models.config.json 解析失败:${(error as Error).message}`);
  }
}
