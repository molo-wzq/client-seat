import { describe, expect, it } from "vitest";
import type {
  AgentEvent,
  AgentReport,
  AgentTicket,
  AgentTrigger,
  AgentTriggerInput,
  DecisionEntry,
  ReportEntry,
  TicketEntry,
  TriggerEntry,
} from "./types";
import { createAgentCore, DemoWorker, type ReportSink } from "./core";
import { InMemoryLedgerStorage } from "./storage";

/**
 * 核心链路契约(工单 02 tracer bullet):给定一条 pet 命令 Trigger,
 * 账本按序追加 Trigger→Decision→Ticket→Report(ready),事件送达订阅者。
 * 只测公开接口 emitTrigger / subscribe / ledger,编排细节不进测试。
 */

function petCommand(text = "把上周投研总结成一句话"): AgentTriggerInput {
  return { source: "pet", kind: "command", data: { text } };
}

/** 演示触发与工单的样例工厂:工单号由调用方定,决议命令按工单号唤醒原工单。 */
function demoTrigger(text: string): AgentTrigger {
  return { id: `tr-${Math.random().toString(36).slice(2, 8)}`, source: "pet", kind: "command", data: { text } };
}
function demoTicket(trigger: AgentTrigger, id = "t-demo"): AgentTicket {
  return { id, triggerId: trigger.id, thread: { kind: "commandId", key: trigger.id } };
}
/** 静默汇报汇:不关心途中汇报的用例用它。 */
const noopSink: ReportSink = async () => undefined;

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

describe("Agent 核心:多 Report 与 tickets()(工单 05)", () => {
  it("同一工单可多次追加 Report:账本按序落两笔,订阅者逐条收到,每条都配气泡", async () => {
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: {
        async run(ticket, _trigger, onReport) {
          await onReport({ ticketId: ticket.id, status: "progress", text: "先拆上周通话" });
          return { ticketId: ticket.id, status: "waiting", text: "两个方向等你拍板" };
        },
      },
    });
    const events: AgentEvent[] = [];
    core.subscribe((event) => events.push(event));

    const outcome = await core.emitTrigger(petCommand("帮我整理上局复盘"));

    expect(outcome.report).toMatchObject({ status: "waiting", text: "两个方向等你拍板" });
    const entries = await core.ledger();
    const reportEntries = entries.filter((entry) => entry.type === "report") as ReportEntry[];
    expect(reportEntries.map((entry) => entry.report.status)).toEqual(["progress", "waiting"]);
    expect(reportEntries.map((entry) => entry.report.ticketId)).toEqual([
      outcome.ticket?.id,
      outcome.ticket?.id,
    ]);
    // seq 只进不退:两笔 Report 排在 Ticket 之后。
    expect(reportEntries.map((entry) => entry.seq)).toEqual([4, 5]);

    const reportEvents = events.filter((event) => event.type === "report");
    expect(reportEvents.map((event) => event.report.status)).toEqual(["progress", "waiting"]);
    expect(events.filter((event) => event.type === "channel")).toHaveLength(2);
  });

  it("tickets() 由账本折叠出每张工单最新状态,且是只读查询", async () => {
    let waitingTicketId = "";
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: {
        async run(ticket, trigger, onReport) {
          const text = String(trigger.data.text);
          if (text === "决议") {
            await onReport({ ticketId: waitingTicketId, status: "ready", text: "拍板后办妥" });
            return { ticketId: ticket.id, status: "ready", text: "已转达" };
          }
          waitingTicketId = ticket.id;
          await onReport({ ticketId: ticket.id, status: "progress", text: "先收集线索" });
          return { ticketId: ticket.id, status: "waiting", text: "等你拍板" };
        },
      },
    });

    await core.emitTrigger(petCommand("本周投研"));
    let tickets = await core.tickets();
    // 只读:查询本身不追加账本。
    expect((await core.ledger()).filter((entry) => entry.type === "report")).toHaveLength(2);
    expect(tickets).toEqual([{ ticketId: waitingTicketId, status: "waiting", text: "等你拍板" }]);

    const decision = await core.emitTrigger(petCommand("决议"));
    tickets = await core.tickets();
    expect(tickets).toEqual([
      { ticketId: waitingTicketId, status: "ready", text: "拍板后办妥" },
      { ticketId: decision.ticket?.id, status: "ready", text: "已转达" },
    ]);
  });
});

describe("DemoWorker 快捷环命令(工单 03)", () => {
  // 快捷环 3 项即时就绪;「本周投研」自工单 05 起走分步演示(见下个 describe)。
  const expectedReplies: Array<[string, RegExp]> = [
    ["换个客户", /名册|新客户/],
    ["再来一局", /(重摆|再来一局|牌桌)/],
    ["上局复盘", /(上局|复盘)/],
  ];

  function runDemoWorker(text: string) {
    const trigger = demoTrigger(text);
    return new DemoWorker().run(demoTicket(trigger), trigger, noopSink);
  }

  it("快捷环即时命令各有确定性中文回复,且不超过 40 字", async () => {
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

describe("DemoWorker 分步演示(工单 05)", () => {
  /** 收集途中汇报的假汇:静默成功,只把 Report 记进数组。 */
  function collectSink(reports: AgentReport[]) {
    return async (report: AgentReport) => {
      reports.push(report);
    };
  }

  /** 即时假钟:不真等,只记每步毫秒数,钉住「分步推进有节奏地走了几步」。 */
  function instantClock() {
    const slept: number[] = [];
    return {
      slept,
      sleep: async (ms: number): Promise<void> => {
        slept.push(ms);
      },
    };
  }

  it("含「并行」的命令分步推进:两条 progress 后就绪", async () => {
    const clock = instantClock();
    const worker = new DemoWorker({ sleep: clock.sleep });
    const midReports: AgentReport[] = [];
    const trigger = demoTrigger("并行整理素材和投研");

    const final = await worker.run(demoTicket(trigger, "t-par"), trigger, collectSink(midReports));

    expect(midReports.map((report) => report.status)).toEqual(["progress", "progress"]);
    expect(midReports.map((report) => report.ticketId)).toEqual(["t-par", "t-par"]);
    expect(final).toMatchObject({ ticketId: "t-par", status: "ready", text: "并行的事都办完了，结果放你手边。" });
    expect(clock.slept).toHaveLength(2);
  });

  it("快捷命令「本周投研」:推进一步后停在 waiting 待人决定", async () => {
    const worker = new DemoWorker({ sleep: instantClock().sleep });
    const midReports: AgentReport[] = [];
    const trigger = demoTrigger("本周投研");

    const final = await worker.run(demoTicket(trigger, "t-week"), trigger, collectSink(midReports));

    expect(midReports.map((report) => report.status)).toEqual(["progress"]);
    expect(final).toMatchObject({ ticketId: "t-week", status: "waiting" });
    expect(final.text).toMatch(/拍板/);
    expect([...final.text].length).toBeLessThanOrEqual(40);
  });

  it("「同意 <工单号>」唤醒等待工单:原工单落 ready,决议自身就绪", async () => {
    const worker = new DemoWorker({ sleep: instantClock().sleep });
    const weekTrigger = demoTrigger("本周投研");
    await worker.run(demoTicket(weekTrigger, "t-week"), weekTrigger, noopSink);

    const midReports: AgentReport[] = [];
    const agreeTrigger = demoTrigger("同意 t-week");
    const final = await worker.run(demoTicket(agreeTrigger, "t-agree"), agreeTrigger, collectSink(midReports));

    expect(midReports).toEqual([{ ticketId: "t-week", status: "ready", text: "收到，按你拍板的出结果。" }]);
    expect(final).toMatchObject({ ticketId: "t-agree", status: "ready" });
  });

  it("「驳回」不带工单号:决议最近一张等待工单,落 dropped", async () => {
    const worker = new DemoWorker({ sleep: instantClock().sleep });
    const weekTrigger = demoTrigger("本周投研");
    await worker.run(demoTicket(weekTrigger, "t-week"), weekTrigger, noopSink);

    const midReports: AgentReport[] = [];
    const rejectTrigger = demoTrigger("驳回");
    const final = await worker.run(demoTicket(rejectTrigger, "t-reject"), rejectTrigger, collectSink(midReports));

    expect(midReports).toEqual([{ ticketId: "t-week", status: "dropped", text: "收到，这条不做了。" }]);
    expect(final).toMatchObject({ ticketId: "t-reject", status: "ready", text: "好，已驳回。" });
  });

  it("没有等待工单时点同意:不落任何决议,直说现状", async () => {
    const worker = new DemoWorker({ sleep: instantClock().sleep });
    const midReports: AgentReport[] = [];
    const trigger = demoTrigger("同意");

    const final = await worker.run(demoTicket(trigger, "t-none"), trigger, collectSink(midReports));

    expect(midReports).toEqual([]);
    expect(final).toMatchObject({ ticketId: "t-none", status: "ready", text: "现在没有等你拍板的工单。" });
  });
});
