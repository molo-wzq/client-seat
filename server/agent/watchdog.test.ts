import { describe, expect, it } from "vitest";
import { DemoWorker } from "./workers/demo";
import { createAgentCore, type AgentWorker } from "./core";
import { InMemoryLedgerStorage } from "./storage";
import { createWatchdog } from "./watchdog";
import type { AgentEvent, AgentReport } from "./types";

/**
 * Watchdog 契约(工单 09,spec 故事 16):工单超过阈值没有新 Report 时,
 * 先重试一次;再超时就追加 blocked Report 写明原因、进待办,且不发桌宠气泡。
 * 只测公开行为:账本、tickets()、订阅事件;时钟可注入,Worker 用模拟卡死的脚本。
 */

const MINUTE = 60_000;

/** 模拟卡住的 Worker:run 永不返回,只记被领走次数。 */
function stuckWorker(): { worker: AgentWorker; runs: () => number } {
  let count = 0;
  return {
    worker: {
      async run(): Promise<AgentReport> {
        count += 1;
        return new Promise<AgentReport>(() => undefined);
      },
    },
    runs: () => count,
  };
}

describe("Watchdog(工单 09)", () => {
  it("超时先重试一次:阈值内不动,过阈值重跑 Worker;重试后未再超时不标受阻", async () => {
    const { worker, runs } = stuckWorker();
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker });
    let t = 0;
    const watchdog = createWatchdog({ agent: core, now: () => t });

    void core.emitTrigger({ source: "pet", kind: "command", data: { text: "跑个长活" } });
    await new Promise((resolve) => setTimeout(resolve, 0)); // 等工单落账(run 已卡住不返回)
    const [ticketId] = (await core.tickets()).map((view) => view.ticketId);
    expect(runs()).toBe(1);
    await watchdog.check(); // t=0 先巡检一次建立基准线(生产里 start() 每分钟都会看一眼)

    t = 5 * MINUTE;
    await watchdog.check();
    expect(runs()).toBe(1); // 未到阈值:不打扰

    t = 10 * MINUTE + 1;
    await watchdog.check();
    expect(runs()).toBe(2); // 过阈值:重试一次(重启 Worker)

    // 重试后仍无汇报,但距重试还没过阈值:不标受阻。
    t = 15 * MINUTE + 2;
    await watchdog.check();
    expect(runs()).toBe(2);
    expect((await core.tickets()).find((view) => view.ticketId === ticketId)).toMatchObject({
      status: "progress",
    });
  });

  it("重试后再超时:追加 blocked Report 写明原因并进待办;Watchdog 不发桌宠气泡,也不重复标受阻", async () => {
    const { worker, runs } = stuckWorker();
    const storage = new InMemoryLedgerStorage();
    const core = createAgentCore({ storage, worker });
    const events: AgentEvent[] = [];
    core.subscribe((event) => events.push(event));
    let t = 0;
    const watchdog = createWatchdog({ agent: core, now: () => t });

    void core.emitTrigger({ source: "pet", kind: "command", data: { text: "跑个长活" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [ticketId] = (await core.tickets()).map((view) => view.ticketId);
    await watchdog.check(); // t=0 建立基准线

    t = 10 * MINUTE + 1;
    await watchdog.check(); // 重试
    t = 20 * MINUTE + 2;
    await watchdog.check(); // 仍卡住 → 标受阻

    expect((await core.tickets()).find((view) => view.ticketId === ticketId)).toMatchObject({
      status: "blocked",
    });
    const blockedText = ((await core.ledger())
      .filter((entry) => entry.type === "report")
      .map((entry) => (entry as { report: AgentReport }).report)
      .find((report) => report.status === "blocked")?.text) ?? "";
    expect(blockedText).toContain("10 分钟");
    expect(blockedText).toContain("重试");
    expect(blockedText).toContain("受阻");

    // 只落 report 事件,不配桌宠气泡(spec 故事 16:Watchdog 不对玩家说话)。
    expect(events.filter((event) => event.type === "report")).toHaveLength(1);
    expect(events.filter((event) => event.type === "channel")).toHaveLength(0);

    // 受阻即收口:再巡检也不重复标受阻。
    t = 60 * MINUTE;
    await watchdog.check();
    expect(runs()).toBe(2);
    expect(
      (await core.ledger()).filter((entry) => entry.type === "report").length,
    ).toBe(1);
  });

  it("阈值可配:短阈值下同样先重试、再标受阻,原因里写实际阈值", async () => {
    const { worker, runs } = stuckWorker();
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker });
    let t = 0;
    const watchdog = createWatchdog({ agent: core, thresholdMs: MINUTE, now: () => t });

    void core.emitTrigger({ source: "pet", kind: "command", data: { text: "跑个长活" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await watchdog.check(); // t=0 建立基准线

    t = MINUTE + 1;
    await watchdog.check();
    expect(runs()).toBe(2);
    t = 2 * MINUTE + 2;
    await watchdog.check();

    const blocked = (await core.tickets()).find((view) => view.status === "blocked");
    expect(blocked?.text).toContain("1 分钟");
  });

  it("等待与已收口的工单不干预:只有还在跑的工单归 Watchdog 管", async () => {
    const demo = new DemoWorker({ sleep: async () => undefined });
    let runs = 0;
    const worker: AgentWorker = {
      run: (ticket, trigger, sink) => {
        runs += 1;
        return demo.run(ticket, trigger, sink);
      },
    };
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker });
    let t = 0;
    const watchdog = createWatchdog({ agent: core, now: () => t });

    await core.emitTrigger({ source: "pet", kind: "command", data: { text: "本周投研" } }); // waiting
    await core.emitTrigger({ source: "pet", kind: "command", data: { text: "去办" } }); // ready
    expect(runs).toBe(2);

    t = 60 * MINUTE;
    await watchdog.check();
    await watchdog.check();

    expect(runs).toBe(2); // 等待人决定/已就绪:不重试
    expect((await core.tickets()).find((view) => view.status === "blocked")).toBeUndefined();
  });
});
