import { DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME } from "../src/adapters/openai-model-adapter";
import { DEFAULT_ASR_MODEL } from "./audio-transcriber";

/**
 * 模型配置按「角色」分组,而不是按供应商:
 * - LLM 组(对话/文案分析/说话人整理):变量名与历史一致,不破坏既有 .env.local;
 * - ASR 组(录音转写,纯音频→文字):可整体换成另一供应商,未填字段回退到 LLM 组。
 */
export const LLM_CONFIG_ENV = {
  key: "MIMO_API_KEY",
  baseUrl: "MIMO_BASE_URL",
  model: "MIMO_MODEL",
} as const;

export const ASR_CONFIG_ENV = {
  key: "ASR_API_KEY",
  baseUrl: "ASR_BASE_URL",
  model: "ASR_MODEL",
} as const;

export interface ResolvedModelConfig {
  /** 未配密钥时为 undefined,由调用方决定降级(演示模式)或报错。 */
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}

export type Env = Record<string, string | undefined>;

/** LLM 配置:对话、文案分析与说话人整理共用。 */
export function readLlmConfig(env: Env): ResolvedModelConfig {
  return {
    apiKey: env[LLM_CONFIG_ENV.key],
    baseUrl: env[LLM_CONFIG_ENV.baseUrl] || DEFAULT_MODEL_BASE_URL,
    model: env[LLM_CONFIG_ENV.model] || DEFAULT_MODEL_NAME,
  };
}

/**
 * ASR 配置:ASR_* 优先;未填的密钥与地址回退到 LLM 组(同一供应商只配一组即可);
 * model 另兼容历史变量 MIMO_ASR_MODEL,默认转写模型——不回退到对话模型。
 */
export function readAsrConfig(env: Env): ResolvedModelConfig {
  const llm = readLlmConfig(env);
  return {
    apiKey: env[ASR_CONFIG_ENV.key] || llm.apiKey,
    baseUrl: env[ASR_CONFIG_ENV.baseUrl] || llm.baseUrl,
    model: env[ASR_CONFIG_ENV.model] || env.MIMO_ASR_MODEL || DEFAULT_ASR_MODEL,
  };
}
