import { describe, expect, it, vi } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { InMemoryStorage } from "../product/in-process-product-api";
import { createProductCore } from "./product-core";
import type { ManagerTurnInput, ManagerTurnOutput } from "./ports";

const FIXED = "好的，先不打扰您了。有需要可以通过银行官方渠道联系我们，再见。";
const LEAVE = "别再打电话了，我现在要去跳舞。";
const FAREWELL = "那您先去跳舞，回头微信上把活动发您，再见。";

function coreWith(
  generateManagerTurn: (input: ManagerTurnInput) => Promise<ManagerTurnOutput>,
) {
  return createProductCore({
    storage: new InMemoryStorage(),
    copywriting: new FakeModelAdapter(),
    dialogue: { generateManagerTurn },
  });
}

describe("客户明确离场时的告别句", () => {
  it("告别接住客户刚说的事", async () => {
    const core = coreWith(async (input) => {
      if (input.customerText.includes("跳舞")) {
        return {
          reply: FAREWELL,
          shouldEnd: false,
          endReason: "模型还想继续",
          outcomeSummary: "客户已报名并同意微信",
        };
      }
      return { reply: "您好，我是咱们行的理财经理，方便说两句吗？" };
    });
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "喂");
    const delta = vi.fn();
    const ended = await core.sendCustomerTurnStream(call.id, LEAVE, delta);

    expect(ended.status).toBe("ended");
    expect(ended.turns.map((turn) => turn.text)).toEqual([
      "喂",
      "您好，我是咱们行的理财经理，方便说两句吗？",
      LEAVE,
      FAREWELL,
    ]);
    expect(ended.turns.at(-1)?.text).toContain("跳舞");
    expect(ended.turns.at(-1)?.text).not.toBe(FIXED);
    expect(delta).toHaveBeenCalledTimes(1);
    expect(delta).toHaveBeenCalledWith(FAREWELL);
    expect(ended.outcomeSummary).not.toMatch(/已报名|同意微信/);
  });

  it("模型出错时落回固定告别句，通话仍然结束", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const core = coreWith(async () => {
      throw new Error("模型调用失败");
    });
    const call = await core.quickStart();
    const delta = vi.fn();
    const ended = await core.sendCustomerTurnStream(call.id, LEAVE, delta);

    expect(ended.status).toBe("ended");
    expect(ended.turns.at(-1)?.text).toBe(FIXED);
    expect(delta).toHaveBeenCalledTimes(1);
    expect(delta).toHaveBeenCalledWith(FIXED);
    expect(ended.endReason).toContain("明确离场");
    warn.mockRestore();
  });

  it("模型无论怎么判，客户离场后通话都结束", async () => {
    const core = coreWith(async () => ({
      reply: "好的，先不打扰了，再见。",
      shouldEnd: false,
      endReason: "模型还想继续",
      outcomeSummary: "客户已报名并同意微信",
    }));
    const call = await core.quickStart();
    const ended = await core.sendCustomerTurn(call.id, LEAVE);

    expect(ended.status).toBe("ended");
    expect(ended.endReason).toBe("客户明确离场，通话结束");
    expect(ended.outcomeSummary).toBe("客户明确结束通话；没有据此新增报名或联系授权。");
    expect(ended.turns.at(-1)?.text).toBe("好的，先不打扰了，再见。");
    expect(ended.turns.at(-1)?.text).not.toBe(FIXED);
  });

  it("空话、不像告别、或对话里没有的数字，都落回固定句", async () => {
    const cases: Array<{ reply: string }> = [
      { reply: "   " },
      { reply: "那您先去跳舞，回头微信上把活动发您。" },
      { reply: "给您150块立减金，再见。" },
    ];
    for (const item of cases) {
      const core = coreWith(async () => ({ reply: item.reply, shouldEnd: false }));
      const call = await core.quickStart();
      const ended = await core.sendCustomerTurn(call.id, LEAVE);
      expect(ended.status).toBe("ended");
      expect(ended.turns.at(-1)?.text).toBe(FIXED);
    }
  });

  it("先前对话里出现过的数字可以留在告别里", async () => {
    const core = coreWith(async (input) => {
      if (input.customerText.includes("跳舞")) {
        return { reply: "那您先去跳舞，20万的事回头微信上说，再见。", shouldEnd: false };
      }
      return { reply: "您那笔大概20万，我先记下了。" };
    });
    const call = await core.quickStart();
    await core.sendCustomerTurn(call.id, "我有20万放在别的行");
    const ended = await core.sendCustomerTurn(call.id, LEAVE);
    expect(ended.status).toBe("ended");
    expect(ended.turns.at(-1)?.text).toBe("那您先去跳舞，20万的事回头微信上说，再见。");
  });
});
