import { describe, expect, it } from "vitest";
import { classifyModelError, errorMessage, maskModelSecrets } from "./model-errors";

/**
 * S5:模型的原始报错不进 Report/账本/玩家气泡——对外只给统一的中文短码,
 * 原文(掩掉形如密钥的串之后)只进服务端日志。
 */

describe("模型错误分类(S5):统一中文短码", () => {
  it("网关错误、鉴权失败、超时、空返回各有短码;其余归通用失败", () => {
    expect(classifyModelError(new Error('语言模型调用失败(HTTP 500):{"error":"boom"}'))).toBe("模型网关错误");
    expect(classifyModelError(new Error("语言模型调用失败(HTTP 401):unauthorized"))).toBe("模型鉴权失败");
    expect(classifyModelError(new Error("语言模型调用失败(HTTP 403):forbidden"))).toBe("模型鉴权失败");
    expect(classifyModelError(new Error("语言模型调用超时(120 秒)"))).toBe("模型超时");
    expect(classifyModelError(new Error("语言模型返回为空"))).toBe("模型返回为空");
    expect(classifyModelError(new Error("语言模型网关未返回流式响应体"))).toBe("模型网关错误");
    expect(classifyModelError(new Error("fetch failed"))).toBe("模型调用失败");
  });

  it("非 Error 的 throw 不二次抛错:按字符串归类取消息", () => {
    expect(classifyModelError("boom")).toBe("模型调用失败");
    expect(errorMessage("boom")).toBe("boom");
    expect(errorMessage(new Error("超时"))).toBe("超时");
  });
});

describe("日志脱敏(S5):形如密钥的串先掩掉再打日志", () => {
  it("sk- 串与 Bearer 凭据被替换,其余原文保留", () => {
    expect(maskModelSecrets("invalid key sk-abc123XYZ-rejected")).toBe("invalid key sk-***");
    expect(maskModelSecrets("Authorization: Bearer abc.def.ghi")).toBe("Authorization: Bearer ***");
    expect(maskModelSecrets('HTTP 500 {"message":"server busy"}')).toBe('HTTP 500 {"message":"server busy"}');
  });
});
