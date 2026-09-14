import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConversationRetentionPolicy } from "../src/domain/conversation-retention";
import type { Env } from "./model-config";

/** 读取仓库根目录 .env.local(若存在);已设置的环境变量优先。 */
export function loadEnvFile(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const envFile = path.join(root, ".env.local");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = stripQuotes(match[2].trim());
    }
  }
}

/** 对话存储上限的环境变量名(spec:.scratch/conversation-retention/spec.md)。 */
export const RETENTION_CONFIG_ENV = {
  maxAgeDays: "CONVERSATION_MAX_AGE_DAYS",
  maxCount: "CONVERSATION_MAX_COUNT",
} as const;

export const DEFAULT_CONVERSATION_MAX_AGE_DAYS = 30;
export const DEFAULT_CONVERSATION_MAX_COUNT = 200;

/**
 * 对话保留配置:未配置用默认;`0` 表示该维度不限;非法值(负数/非整数)抛错,
 * 由组合根按启动失败处理(与 PORT 校验同风格)。
 */
export function readConversationRetention(env: Env): ConversationRetentionPolicy {
  const maxAgeDays = readPositiveInt(
    env[RETENTION_CONFIG_ENV.maxAgeDays],
    DEFAULT_CONVERSATION_MAX_AGE_DAYS,
    RETENTION_CONFIG_ENV.maxAgeDays,
  );
  const maxCount = readPositiveInt(
    env[RETENTION_CONFIG_ENV.maxCount],
    DEFAULT_CONVERSATION_MAX_COUNT,
    RETENTION_CONFIG_ENV.maxCount,
  );
  return {
    maxAgeMs: maxAgeDays === 0 ? null : maxAgeDays * 24 * 60 * 60 * 1000,
    maxCount: maxCount === 0 ? null : maxCount,
  };
}

/** 读非负整数(0=不限由调用方解释);缺省回退默认值。 */
function readPositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 配置不合法:${raw}(需要 0 或正整数,0 表示不限制)`);
  }
  return value;
}

/** 按 dotenv 惯例剥离值两侧成对的引号:KEY="value" 的值不应含引号。 */
function stripQuotes(value: string): string {
  const double = value.match(/^"(.*)"$/s);
  if (double) return double[1];
  const single = value.match(/^'(.*)'$/s);
  if (single) return single[1];
  return value;
}
