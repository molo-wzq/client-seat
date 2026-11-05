import { describe, expect, it } from "vitest";
import { DemoWorker } from "./workers/demo";
import { createAgentCore, type AgentWorker } from "./core";
import { createModelWorkers } from "./workers";
import { InMemoryLedgerStorage } from "./storage";
import { createWatchdog } from "./watchdog";
import type { AgentReport, AgentTriggerInput } from "./types";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStorage } from "../file-store";

const command = (text: string): AgentTriggerInput => ({ source: "pet", kind: "command", data: { text } });
const worker = () => new DemoWorker({ sleep: async () => undefined });

describe("Agent 状态加固", () => {
  it("重复或失效的显式审批不会处理另一张待办", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: worker() });
    const a = await core.emitTrigger(command("本周投研"));
    const b = await core.emitTrigger(command("本周投研"));
    await core.emitTrigger(command(`同意 ${a.ticket!.id}`));
    await core.emitTrigger(command(`同意 ${a.ticket!.id}`));
    await core.emitTrigger(command("驳回 nonexistent"));
    expect((await core.tickets()).find(t => t.ticketId === b.ticket!.id)?.status).toBe("waiting");
  });

  it("并发的相反决定只接受第一次，不反转已完成的工单", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: worker() });
    const a = await core.emitTrigger(command("本周投研"));
    await Promise.all([
      core.emitTrigger(command(`同意 ${a.ticket!.id}`)),
      core.emitTrigger(command(`驳回 ${a.ticket!.id}`)),
    ]);
    const reports = (await core.ledger()).filter(e => e.type === "report" && e.report.ticketId === a.ticket!.id);
    expect(reports.filter(e => e.type === "report" && ["ready", "dropped"].includes(e.report.status))).toHaveLength(1);
    expect((await core.tickets()).find(t => t.ticketId === a.ticket!.id)?.status).toBe("ready");
  });

  it("重建 core/worker 后可批注并审批原账本待办", async () => {
    const storage = new InMemoryLedgerStorage();
    const first = createAgentCore({ storage, worker: worker(), initialAcceptMode: "auto" });
    const a = await first.emitTrigger({ source: "materials", kind: "dropped", data: { fileName: "test.wav", fileKind: "audio" } });
    const restarted = createAgentCore({ storage, worker: worker(), initialAcceptMode: "auto" });
    await restarted.emitTrigger({ source: "pet", kind: "annotate", data: { ticketId: a.ticket!.id, note: "补充来源" } });
    expect((await restarted.tickets()).find(t => t.ticketId === a.ticket!.id)?.text).toContain("批注改好了");
    await restarted.emitTrigger(command(`同意 ${a.ticket!.id}`));
    expect((await restarted.tickets()).find(t => t.ticketId === a.ticket!.id)?.status).toBe("ready");
  });

  it("Watchdog 重试返回的最终结果落账，不再误标受阻", async () => {
    let runs = 0;
    const retryWorker: AgentWorker = { async run(ticket) {
      if (++runs === 1) return new Promise<AgentReport>(() => undefined);
      return { ticketId: ticket.id, status: "ready", text: "恢复完成" };
    } };
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: retryWorker });
    void core.emitTrigger(command("长任务"));
    await new Promise(r => setTimeout(r, 0));
    let now = 0;
    const watchdog = createWatchdog({ agent: core, now: () => now, thresholdMs: 10 });
    await watchdog.check(); now = 11; await watchdog.check();
    await new Promise(r => setTimeout(r, 0));
    now = 22; await watchdog.check(); now = 33; await watchdog.check();
    expect((await core.tickets())[0]).toMatchObject({ status: "ready", text: "恢复完成" });
  });

  it("原执行迟到结果不能覆盖重试成功，终态工单不再重试", async () => {
    let finishOld!: (report: AgentReport) => void;
    let runs = 0;
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: { async run(ticket) {
      runs++;
      if (runs === 1) return new Promise<AgentReport>(resolve => { finishOld = resolve; });
      if (runs === 2) return { ticketId: ticket.id, status: "ready", text: "重试成功" };
      throw new Error("worker failed");
    } } });
    const original = core.emitTrigger(command("长任务"));
    await new Promise(r => setTimeout(r, 0));
    const id = (await core.tickets())[0].ticketId;
    await core.retryTicket(id); await new Promise(r => setTimeout(r, 0));
    finishOld({ ticketId: id, status: "failed", text: "旧执行迟到" });
    await original;
    expect((await core.tickets())[0]).toMatchObject({ status: "ready", text: "重试成功" });
    expect(await core.retryTicket(id)).toBe(false);
  });

  it("重试异常落 failed，首次执行异常也有终态而非悬挂", async () => {
    let runs = 0;
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: { async run() {
      if (++runs === 1) return new Promise<AgentReport>(() => undefined);
      throw new Error("test failure");
    } } });
    void core.emitTrigger(command("长任务"));
    await new Promise(r => setTimeout(r, 0));
    await core.retryTicket((await core.tickets())[0].ticketId);
    await new Promise(r => setTimeout(r, 0));
    expect((await core.tickets())[0].status).toBe("failed");
    expect((await core.emitTrigger(command("新任务"))).report?.status).toBe("failed");
  });

  it("重试仅报 progress 后再次卡住仍会受阻，不会无限重启", async () => {
    let runs = 0;
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: { async run(ticket, _trigger, { onReport: sink }) {
      if (++runs > 1) await sink({ ticketId: ticket.id, status: "progress", text: "重试开始" });
      return new Promise<AgentReport>(() => undefined);
    } } });
    void core.emitTrigger(command("长任务"));
    await new Promise(r => setTimeout(r, 0));
    let now = 0;
    const watchdog = createWatchdog({ agent: core, now: () => now, thresholdMs: 10 });
    await watchdog.check(); now = 11; await watchdog.check();
    await new Promise(r => setTimeout(r, 0));
    now = 12; await watchdog.check(); now = 23; await watchdog.check();
    expect(runs).toBe(2);
    expect((await core.tickets())[0].status).toBe("blocked");
  });

  it("新建 FileStorage 与 Worker 后仍可审批磁盘中的待办", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "client-seat-agent-test-"));
    const file = path.join(dir, "db.json");
    try {
      const first = createAgentCore({ storage: new FileStorage(file), worker: worker() });
      const a = await first.emitTrigger(command("本周投研"));
      const restarted = createAgentCore({ storage: new FileStorage(file), worker: worker() });
      await restarted.emitTrigger(command(`同意 ${a.ticket!.id}`));
      const persisted = createAgentCore({ storage: new FileStorage(file), worker: worker() });
      expect((await persisted.tickets()).find(t => t.ticketId === a.ticket!.id)?.status).toBe("ready");
    } finally {
      await rm(file, { force: true });
      await rmdir(dir);
    }
  });

  it("卡住的审批重试后会释放队列，后续决定仍可执行", async () => {
    let runs = 0;
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: { async run(ticket) {
      if (++runs === 1) return new Promise<AgentReport>(() => undefined);
      return { ticketId: ticket.id, status: "ready", text: "完成" };
    } } });
    const original = core.emitTrigger(command("同意 old"));
    await new Promise(r => setTimeout(r, 0));
    const next = core.emitTrigger(command("同意 next"));
    await core.retryTicket((await core.tickets())[0].ticketId);
    await original;
    await next;
    await new Promise(r => setTimeout(r, 0));
    expect((await core.tickets()).map(t => t.status)).toEqual(["ready", "ready"]);
    expect(runs).toBe(3);
  });

  it("共享写入未开放时保留待审投研，批注仍能找到既有素材工单", async () => {
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: createModelWorkers({ demoSleep: async () => undefined, demoChatSleep: async () => undefined }),
      initialAcceptMode: "auto",
    });
    const research = await core.emitTrigger({ source: "research", kind: "research-due", data: { weekId: "w-1" } });
    expect(research.report?.status).toBe("waiting");

    const outcome = await core.emitTrigger(command(`同意 ${research.ticket!.id}`));
    expect(outcome.report).toMatchObject({ status: "failed", text: expect.stringContaining("共享档案写入未开放") });
    expect((await core.tickets()).find((t) => t.ticketId === research.ticket!.id)?.status).toBe("waiting");

    const dropped = await core.emitTrigger({
      source: "materials",
      kind: "dropped",
      data: { fileName: "a.wav", fileKind: "audio" },
    });
    await core.emitTrigger({ source: "pet", kind: "annotate", data: { ticketId: dropped.ticket!.id, note: "补一句来源" } });
    expect((await core.tickets()).find((t) => t.ticketId === dropped.ticket!.id)?.text).toContain("批注");
  });
});
