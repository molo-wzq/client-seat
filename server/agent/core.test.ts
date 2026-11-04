import { describe, expect, it } from "vitest";
import type {
  AgentEvent,
  AgentTrigger,
  AgentTriggerInput,
  DecisionEntry,
  ReportEntry,
  TicketEntry,
  TriggerEntry,
} from "./types";
import { createAgentCore, DemoWorker } from "./core";
import { InMemoryLedgerStorage } from "./storage";

/**
 * 核心链路契约(工单 02 tracer bullet):给定一条 pet 命令 Trigger,
 * 账本按序追加 Trigger→Decision→Ticket→Report(ready),事件送达订阅者。
 * 只测公开接口 emitTrigger / subscribe / ledger,编排细节不进测试。
 */

function petCommand(text = "把上周投研总结成一句话"): AgentTriggerInput {
  return { source: "pet", kind: "command", data: { text } };
}

describe("Agent 核心(工单 02)", () => {
  it("pet 命令:账本按序追加 Trigger→Decision→Ticket→Report(ready)", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });

    const outcome = await core.emitTrigger(petCommand());

    expect(outcome.admitted).toBe(true);
    expect(outcome.report).toMatchObject({ status: "ready", text: "收到，马上办" });

    const entries = await core.ledger();
    expect(entries.map((entry) => entry.type)).toEqual(["trigger", "decision", "ticket", "report"]);
    // seq 由存储按追加顺序分配,账本只追加。
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);

    const [triggerEntry, decisionEntry, ticketEntry, reportEntry] = entries as [
      TriggerEntry,
      DecisionEntry,
      TicketEntry,
      ReportEntry,
    ];
    expect(triggerEntry.trigger).toMatchObject({ source: "pet", kind: "command" });
    expect(triggerEntry.trigger.id).toBeTruthy();
    expect(decisionEntry.decision).toMatchObject({ triggerId: triggerEntry.trigger.id, admitted: true });
    expect(ticketEntry.ticket.triggerId).toBe(triggerEntry.trigger.id);
    expect(ticketEntry.ticket.thread).toMatchObject({ kind: "commandId", key: triggerEntry.trigger.id });
    expect(reportEntry.report).toMatchObject({
      ticketId: ticketEntry.ticket.id,
      status: "ready",
      text: "收到，马上办",
    });
  });

  it("空命令:Eval 拒绝,账本止于 Decision,不产 Ticket/Report", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });

    const outcome = await core.emitTrigger(petCommand("   "));

    expect(outcome.admitted).toBe(false);
    expect(outcome.ticket).toBeNull();
    expect(outcome.report).toBeNull();

    const entries = await core.ledger();
    expect(entries.map((entry) => entry.type)).toEqual(["trigger", "decision"]);
    const decisionEntry = entries[1] as DecisionEntry;
    expect(decisionEntry.decision.admitted).toBe(false);
    expect(decisionEntry.decision.reason).toContain("命令内容为空");
  });

  it("订阅者按序收到 report 与 channel 事件;退订后不再收到", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });
    const events: AgentEvent[] = [];
    const unsubscribe = core.subscribe((event) => events.push(event));

    await core.emitTrigger(petCommand());

    expect(events.map((event) => event.type)).toEqual(["report", "channel"]);
    const reportEvent = events[0] as Extract<AgentEvent, { type: "report" }>;
    const channelEvent = events[1] as Extract<AgentEvent, { type: "channel" }>;
    expect(reportEvent.report).toMatchObject({ status: "ready", text: "收到，马上办" });
    expect(channelEvent.channel).toMatchObject({
      target: "pet-bubble",
      ticketId: reportEvent.report.ticketId,
      text: "收到，马上办",
    });

    unsubscribe();
    await core.emitTrigger(petCommand());
    expect(events).toHaveLength(2);
  });

  it("桌宠气泡硬上限 40 字:超长 Report 截断后才进 Channel(spec)", async () => {
    const longText = "这局经理值得学的一招是".repeat(6); // 66 字
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: {
        // 长回复伪 Worker:只证明气泡截断,账本里 Report 保留原文。
        async run(ticket) {
          return { ticketId: ticket.id, status: "ready", text: longText };
        },
      },
    });
    const events: AgentEvent[] = [];
    core.subscribe((event) => events.push(event));

    await core.emitTrigger(petCommand());

    const reportEntry = (await core.ledger()).at(-1) as ReportEntry;
    expect(reportEntry.report.text).toBe(longText);
    const channelEvent = events.find((event) => event.type === "channel") as Extract<
      AgentEvent,
      { type: "channel" }
    >;
    expect(channelEvent.channel.text).toHaveLength(40);
    expect(channelEvent.channel.text).toBe([...longText].slice(0, 40).join(""));
  });

  it("非法 source 或 kind → ValidationError(400),且不落账本", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });

    await expect(
      core.emitTrigger({ source: "nope" as unknown as AgentTriggerInput["source"], kind: "command", data: {} }),
    ).rejects.toThrow("触发来源不合法");
    await expect(
      core.emitTrigger({ source: "pet", kind: "magic" as unknown as AgentTriggerInput["kind"], data: {} }),
    ).rejects.toThrow("触发类型不合法");
    expect(await core.ledger()).toEqual([]);
  });
});

describe("DemoWorker 快捷环命令(工单 03)", () => {
  // 快捷环 4 项的确定性回复:桌宠以客户侧搭档口吻对玩家说话,不评价玩家,不超过 40 字。
  const expectedReplies: Array<[string, RegExp]> = [
    ["换个客户", /名册|新客户/],
    ["再来一局", /(重摆|再来一局|牌桌)/],
    ["上局复盘", /(上局|复盘)/],
    ["本周投研", /(投研|周报|本周)/],
  ];

  function runDemoWorker(text: string) {
    const trigger: AgentTrigger = { id: "tr-demo", source: "pet", kind: "command", data: { text } };
    return new DemoWorker().run(
      { id: "t-demo", triggerId: trigger.id, thread: { kind: "commandId", key: trigger.id } },
      trigger,
    );
  }

  it("快捷环 4 条命令各有确定性中文回复,且不超过 40 字", async () => {
    for (const [command, pattern] of expectedReplies) {
      const report = await runDemoWorker(command);
      expect(report.status).toBe("ready");
      expect(report.text).toMatch(pattern);
      expect([...report.text].length).toBeLessThanOrEqual(40);
    }
  });

  it("其余命令统一回「收到，马上办」", async () => {
    expect(await runDemoWorker("帮我把素材库里最热的卡整理成一句话")).toMatchObject({
      status: "ready",
      text: "收到，马上办",
    });
  });
});
