import { describe, expect, it } from "vitest";
import { createAgentCore } from "./core";
import { createModelWorkers } from "./workers";
import { InMemoryLedgerStorage } from "./storage";

/**
 * 牌局事件驱动的表情(工单 16 微反应)测试缝:经理出卡 / 隐藏牌被问到 /
 * 玩家揭示三类 table 触发,由 Worker 落成带表情的 Report——
 * 出招看局(think)、被问到边上(pout)、玩家翻牌(cheer);
 * Report 一律 dropped(沉默:对局中桌宠不说话,只用表情,spec 故事 3),
 * 不出气泡、不进待办;缺对局号不立项。
 */

function makeCore() {
  return createAgentCore({
    storage: new InMemoryLedgerStorage(),
    worker: createModelWorkers({ demoSleep: async () => undefined, demoChatSleep: async () => undefined }),
  });
}

const tableTrigger = (kind: "card-played" | "hidden-raised" | "hidden-revealed", data: Record<string, unknown> = {}) => ({
  source: "table" as const,
  kind,
  data: { gameId: "c-1", ...data },
});

describe("牌局事件驱动的表情(工单 16)", () => {
  it("经理出卡 → think:出招看局;Report dropped 不出气泡", async () => {
    const core = makeCore();
    const outcome = await core.emitTrigger(tableTrigger("card-played", { cardId: "sc-1", cardName: "存款搬家" }));

    expect(outcome.admitted).toBe(true);
    expect(outcome.report).toMatchObject({ status: "dropped", emotion: "think" });
  });

  it("隐藏牌被问到 → pout;玩家揭示 → cheer", async () => {
    const core = makeCore();
    const raised = await core.emitTrigger(tableTrigger("hidden-raised", { item: "儿子留学要用 40 万" }));
    const revealed = await core.emitTrigger(tableTrigger("hidden-revealed", { item: "儿子留学要用 40 万" }));

    expect(raised.report).toMatchObject({ emotion: "pout" });
    expect(revealed.report).toMatchObject({ emotion: "cheer" });
  });

  it("对局中不说话:反应 Report 一律 dropped,不配气泡、不进待办", async () => {
    const core = makeCore();
    const events: Array<{ type: string; channel?: unknown }> = [];
    core.subscribe((event) => events.push({ type: event.type, ...(event.type === "channel" ? { channel: event.channel } : {}) }));

    await core.emitTrigger(tableTrigger("card-played", { cardId: "sc-1" }));

    // 只有 report 事件,没有 pet-bubble 气泡;工单也不在待办(waiting/blocked)里。
    expect(events.some((event) => event.type === "report")).toBe(true);
    expect(events.some((event) => event.type === "channel")).toBe(false);
    expect((await core.tickets()).every((ticket) => ticket.status !== "waiting" && ticket.status !== "blocked")).toBe(true);
  });

  it("缺对局号不立项(与 game-ended 同一口径)", async () => {
    const core = makeCore();
    const outcome = await core.emitTrigger({ source: "table", kind: "card-played", data: {} });

    expect(outcome.admitted).toBe(false);
    expect(outcome.report).toBeNull();
  });

  it("pet 域冒名发牌局事件被拒(来源校验 S1)", async () => {
    const core = makeCore();
    await expect(
      core.emitTrigger({ source: "pet", kind: "card-played", data: { gameId: "c-1" } }),
    ).rejects.toThrow("只能来自");
  });
});
