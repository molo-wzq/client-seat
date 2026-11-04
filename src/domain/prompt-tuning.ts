/**
 * 提示词调优实验开关(原在 openai-model-adapter,挪到领域层共用):
 * 默认关闭的开关显式置 1 启用;默认开启的仅置 0 关闭。
 * 经 globalThis 取 process:本文件同时进浏览器包,src 侧 tsconfig 无 node 类型。
 */

export const PROMPT_TUNING_ENV = {
  /** p13 实验:尾部语体短提醒。p15 起默认开,置 0 可关。 */
  tailReminder: "LLM_TAIL_REMINDER",
  /** p13 实验:开场语体示范轮,默认关。 */
  styleDemo: "LLM_STYLE_DEMO",
  /** p15 实验:话术流式调用关闭思维链(thinking.type=disabled),默认关。 */
  managerNoThinking: "LLM_MANAGER_NO_THINKING",
  /** 世界书式检索注入:按客户发言关键词决定哪些已发布策略卡上桌,默认关(全量注入)。 */
  cardRetrieval: "LLM_CARD_RETRIEVAL",
} as const;

/** 默认开启的开关:仅显式置 0 时关闭(如 LLM_TAIL_REMINDER=0)。 */
export function tuningDisabled(name: string): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name] === "0";
}

/** 默认关闭的开关:显式置 1 时启用(如 LLM_CARD_RETRIEVAL=1)。 */
export function tuningEnabled(name: string): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name] === "1";
}
