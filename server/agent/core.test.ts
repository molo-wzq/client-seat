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

describe("对局后复盘一句话(工单 06)", () => {
  /** 一局样例:三轮经理话术,前两轮用了卡,第 2 轮话最实(最长)。 */
  const ROUNDS = [
    { managerText: "我是咱们行的理财经理小王。", cardId: "c1" },
    { managerText: "之前要是接到过推销电话,还请您多担待。", cardId: "c1" },
    { managerText: "我先跟您说下活动规则。" },
  ];

  function gameEnded(rounds: Array<Record<string, unknown>>): AgentTriggerInput {
    return { source: "table", kind: "game-ended", data: { gameId: "conv-1", rounds, hiddenUnrevealedCount: 2 } };
  }

  it("对局结束:复盘 Worker 起草一句话(只评经理、≤40 字、带依据),气泡同步推送", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });
    const events: AgentEvent[] = [];
    core.subscribe((event) => events.push(event));

    const outcome = await core.emitTrigger(gameEnded(ROUNDS));

    expect(outcome.admitted).toBe(true);
    expect(outcome.report?.status).toBe("ready");
    // 只评经理:点名轮次与「值得学」,不出现对玩家说的话。
    const text = outcome.report?.text ?? "";
    expect([...text].length).toBeLessThanOrEqual(40);
    expect(text).toMatch(/第2轮/);
    expect(text).toMatch(/值得学/);
    expect(text).not.toMatch(/你|玩家/);
    // 依据(展开用):轮次 + 策略卡,对局号对上本局。
    expect(outcome.report?.basis).toEqual({ gameId: "conv-1", turnNumber: 2, cardId: "c1" });

    // 账本按序追加,Thread 按 spec 的 gameId 键归并本局。
    const entries = await core.ledger();
    expect(entries.map((entry) => entry.type)).toEqual(["trigger", "decision", "ticket", "report"]);
    const ticketEntry = entries[2] as TicketEntry;
    expect(ticketEntry.ticket.thread).toEqual({ kind: "gameId", key: "conv-1" });

    // 一句话同文进桌宠气泡(既有 Channel 通道)。
    const channelEvent = events.find((event) => event.type === "channel") as Extract<
      AgentEvent,
      { type: "channel" }
    >;
    expect(channelEvent.channel.text).toBe(text);
  });

  it("没有用卡轮(无值得说的内容):Report 落 dropped,不出气泡", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });
    const events: AgentEvent[] = [];
    core.subscribe((event) => events.push(event));

    const outcome = await core.emitTrigger(gameEnded([{ managerText: "喂,您好。" }]));

    expect(outcome.report).toMatchObject({ status: "dropped" });
    expect(outcome.report?.basis).toBeUndefined();
    // 账本如实记 dropped(工单视图显示「已放弃」),但桌宠保持沉默:不推气泡。
    const entries = await core.ledger();
    expect(entries.map((entry) => entry.type)).toEqual(["trigger", "decision", "ticket", "report"]);
    expect(events.filter((event) => event.type === "report")).toHaveLength(1);
    expect(events.filter((event) => event.type === "channel")).toHaveLength(0);
  });

  it("事件不完整(缺轮次或缺对局号):Eval 拒绝,链路止于 Decision", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });

    const noRounds = await core.emitTrigger({ source: "table", kind: "game-ended", data: { gameId: "conv-1" } });
    expect(noRounds.admitted).toBe(false);
    const noGameId = await core.emitTrigger({ source: "table", kind: "game-ended", data: { rounds: ROUNDS } });
    expect(noGameId.admitted).toBe(false);

    // 各止于 Decision,不产 Ticket/Report,Worker 不空跑。
    const entries = await core.ledger();
    expect(entries.map((entry) => entry.type)).toEqual(["trigger", "decision", "trigger", "decision"]);
    const decisions = entries.filter((entry) => entry.type === "decision") as DecisionEntry[];
    expect(decisions.map((entry) => entry.decision.admitted)).toEqual([false, false]);
    expect(decisions.every((entry) => entry.decision.reason.includes("对局结束"))).toBe(true);
  });
});

describe("拖给它:素材入草稿(工单 07)", () => {
  /** 即时假钟:素材 Worker 的分步节奏不真等,只记每步毫秒数。 */
  function instantClock() {
    const slept: number[] = [];
    return {
      slept,
      sleep: async (ms: number): Promise<void> => {
        slept.push(ms);
      },
    };
  }

  function dropCore() {
    const clock = instantClock();
    return {
      clock,
      core: createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker({ sleep: clock.sleep }) }),
    };
  }

  function dropped(fileKind: "audio" | "persona" | "role", fileName = "王姐通话.mp3"): AgentTriggerInput {
    return { source: "materials", kind: "dropped", data: { fileName, fileKind } };
  }

  it("拖入录音:分步推进(转写中→分析中→起草中)后停在 waiting 草稿待审", async () => {
    const { clock, core } = dropCore();

    const outcome = await core.emitTrigger(dropped("audio"));

    expect(outcome.admitted).toBe(true);
    expect(outcome.report?.status).toBe("waiting");
    // waiting 文案点名草稿待审;每条汇报都不超气泡上限 40 字。
    expect(outcome.report?.text).toMatch(/草稿/);
    for (const text of (await core.ledger())
      .filter((entry) => entry.type === "report")
      .map((entry) => (entry as ReportEntry).report.text)) {
      expect([...text].length).toBeLessThanOrEqual(40);
    }

    // 账本:同一工单依次落 转写中→分析中→起草中→waiting(草稿待审)。
    const reports = (await core.ledger())
      .filter((entry) => entry.type === "report")
      .map((entry) => (entry as ReportEntry).report);
    expect(reports.map((report) => report.ticketId)).toEqual(Array(4).fill(outcome.ticket?.id));
    expect(reports.map((report) => report.status)).toEqual(["progress", "progress", "progress", "waiting"]);
    expect(reports[0]?.text).toMatch(/转写/);
    expect(reports[1]?.text).toMatch(/分析/);
    expect(reports[2]?.text).toMatch(/起草/);
    expect(clock.slept).toHaveLength(3);

    // 工单视图折叠到 waiting,即待办面板里那张待审卡。
    expect(await core.tickets()).toEqual([
      { ticketId: outcome.ticket?.id, status: "waiting", text: outcome.report?.text },
    ]);
  });

  it("画像 JSON 与角色卡同样准入;缺文件名或类型不识别 → Eval 拒绝,不立项", async () => {
    const { core } = dropCore();

    for (const fileKind of ["persona", "role"] as const) {
      const ok = await core.emitTrigger(dropped(fileKind, "李姐.json"));
      expect(ok.admitted).toBe(true);
      expect(ok.report?.status).toBe("waiting");
    }

    const noName = await core.emitTrigger({ source: "materials", kind: "dropped", data: { fileKind: "audio" } });
    expect(noName.admitted).toBe(false);
    expect(noName.ticket).toBeNull();
    const badKind = await core.emitTrigger({
      source: "materials",
      kind: "dropped",
      data: { fileName: "x.mp4", fileKind: "video" },
    });
    expect(badKind.admitted).toBe(false);
    expect(badKind.ticket).toBeNull();
    // 拒绝的两条止于 Decision,Worker 不空跑。
    const decisions = (await core.ledger())
      .filter((entry) => entry.type === "decision")
      .map((entry) => (entry as DecisionEntry).decision);
    expect(decisions.map((decision) => decision.admitted)).toEqual([true, true, false, false]);
  });

  it("待审批注唤醒原工单:同一 ticketId 追加 progress→waiting(按批注改过的草稿)", async () => {
    const { core } = dropCore();
    const drop = await core.emitTrigger(dropped("audio"));
    const ticketId = drop.ticket?.id ?? "";

    const annotate = await core.emitTrigger({
      source: "pet",
      kind: "annotate",
      data: { ticketId, note: "第二句改口语一点" },
    });

    expect(annotate.admitted).toBe(true);
    // 原工单被唤醒:同一 ticketId 上依次 3×progress→waiting,再追加 progress→waiting。
    const reports = (await core.ledger())
      .filter((entry) => entry.type === "report")
      .map((entry) => (entry as ReportEntry).report)
      .filter((report) => report.ticketId === ticketId);
    expect(reports.map((report) => report.status)).toEqual([
      "progress",
      "progress",
      "progress",
      "waiting",
      "progress",
      "waiting",
    ]);
    // 新 waiting 是按批注改过的草稿,仍待人决定(工单视图原位覆盖,不新增工单)。
    const waiting = reports.at(-1);
    expect(waiting?.text).toMatch(/批注/);
    expect([...waiting?.text ?? ""].length).toBeLessThanOrEqual(40);
    expect((await core.tickets()).filter((view) => view.ticketId === ticketId)).toEqual([
      { ticketId, status: "waiting", text: waiting?.text },
    ]);
    // 批注自身像决议一样是一张小工单,转达完就绪。
    expect(annotate.report).toMatchObject({ ticketId: annotate.ticket?.id, status: "ready" });
  });

  it("批注不完整 → Eval 拒绝;批注的工单不在等待中 → 直说现状,不落任何唤醒汇报", async () => {
    const { core } = dropCore();
    const drop = await core.emitTrigger(dropped("audio"));
    const reportsBefore = (await core.ledger()).filter((entry) => entry.type === "report").length;

    const noNote = await core.emitTrigger({
      source: "pet",
      kind: "annotate",
      data: { ticketId: drop.ticket?.id ?? "", note: "  " },
    });
    expect(noNote.admitted).toBe(false);
    const noTicket = await core.emitTrigger({ source: "pet", kind: "annotate", data: { note: "改一下" } });
    expect(noTicket.admitted).toBe(false);

    // 先「同意」收掉等待,再批注:原工单已不在等待中,只回现状,不追加任何汇报。
    await core.emitTrigger({ source: "pet", kind: "command", data: { text: `同意 ${drop.ticket?.id}` } });
    const late = await core.emitTrigger({
      source: "pet",
      kind: "annotate",
      data: { ticketId: drop.ticket?.id ?? "", note: "再改改" },
    });
    expect(late.admitted).toBe(true);
    expect(late.report).toMatchObject({ status: "ready" });
    expect(late.report?.text).toMatch(/没有/);
    // 除决议与批注自身的转达汇报外,原工单没有再被唤醒。
    const reports = (await core.ledger())
      .filter((entry) => entry.type === "report")
      .map((entry) => (entry as ReportEntry).report);
    expect(reports.filter((report) => report.ticketId === drop.ticket?.id && report.status === "waiting")).toHaveLength(1);
    expect(reports.length - reportsBefore).toBe(3); // 同意落 ready + 批注转达 ready + 批注现状 ready
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
