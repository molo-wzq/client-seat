import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONVERSATION_MAX_AGE_DAYS,
  DEFAULT_CONVERSATION_MAX_COUNT,
  readConversationRetention,
  RETENTION_CONFIG_ENV,
} from "./env";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("对话存储上限配置", () => {
  it("未配置时用默认值:30 天 / 200 通", () => {
    const policy = readConversationRetention({});
    expect(policy).toEqual({
      maxAgeMs: DEFAULT_CONVERSATION_MAX_AGE_DAYS * DAY_MS,
      maxCount: DEFAULT_CONVERSATION_MAX_COUNT,
    });
  });

  it("显式配置生效:7 天 / 50 通", () => {
    const policy = readConversationRetention({
      [RETENTION_CONFIG_ENV.maxAgeDays]: "7",
      [RETENTION_CONFIG_ENV.maxCount]: "50",
    });
    expect(policy).toEqual({ maxAgeMs: 7 * DAY_MS, maxCount: 50 });
  });

  it("0 表示该维度不限制", () => {
    const policy = readConversationRetention({
      [RETENTION_CONFIG_ENV.maxAgeDays]: "0",
      [RETENTION_CONFIG_ENV.maxCount]: "0",
    });
    expect(policy).toEqual({ maxAgeMs: null, maxCount: null });
  });

  it("非法值报错:负数与小数都不接受", () => {
    expect(() => readConversationRetention({ [RETENTION_CONFIG_ENV.maxAgeDays]: "-1" })).toThrow(
      "CONVERSATION_MAX_AGE_DAYS",
    );
    expect(() => readConversationRetention({ [RETENTION_CONFIG_ENV.maxCount]: "1.5" })).toThrow(
      "CONVERSATION_MAX_COUNT",
    );
    expect(() => readConversationRetention({ [RETENTION_CONFIG_ENV.maxCount]: "abc" })).toThrow(
      "CONVERSATION_MAX_COUNT",
    );
  });
});
