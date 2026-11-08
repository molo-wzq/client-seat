import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentReport, AgentTicket, AgentTrigger } from "./types";
import { createAgentCore, type ReportSink } from "./core";
import { createModelWorkers, type AgentModelMessage, type AgentModelPort } from "./workers";
import { InMemoryLedgerStorage } from "./storage";

/**
 * 真实模型 Worker(工单 11)约定测试缝:一律用假模型端口,不发网络请求。
 * - 对话 Worker:流式 delta、表情标签剥离、快捷动作建议、120 字截断、出错回退 demo 且 Report=failed;
 * - 投研/盲区 Worker:只产出 waiting 草稿,人审闸门不变(ADR 0007),Worker 手上没有任何发布接口;
 * - 脱敏:delta 与 Report 共用同一个可注入 redact 出口(S4),默认不做处理。
 */

/** 假模型端口:排队回放预设回复,逐字流式回调;置 error 可模拟网关故障。 */
class FakeModelPort implements AgentModelPort {
  readonly calls: Array<{ messages: AgentModelMessage[] }> = [];
  private readonly queue: string[] = [];
  error: Error | null = null;
  /** S2 场景:先把 delta 逐字流出,再抛错(半截真实输出后失败)。 */
  failAfter: { delta: string; error: Error } | null = null;

  enqueue(reply: string): void {
    this.queue.push(reply);
  }

  async completeStream(
    messages: AgentModelMessage[],
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    this.calls.push({ messages: messages.map((message) => ({ ...message })) });
    if (this.error) throw this.error;
    if (this.failAfter) {
      for (const char of [...this.failAfter.delta]) onDelta?.(char);
      throw this.failAfter.error;
    }
    const reply = this.queue.shift() ?? "好";
    for (const char of [...reply]) onDelta?.(char);
    return reply;
  }
}

function chatTrigger(text: string, extra: Record<string, unknown> = {}): AgentTrigger {
  return {
    id: `tr-${Math.random().toString(36).slice(2, 8)}`,
    source: "pet",
    kind: "chat",
    data: { text, ...extra },
  };
}

function ticketOf(trigger: AgentTrigger): AgentTicket {
  return { id: "t-chat", triggerId: trigger.id, thread: { kind: "commandId", key: trigger.id } };
}

function researchTrigger(): AgentTrigger {
  return { id: "tr-research", source: "research", kind: "research-due", data: { weekId: "w-42" } };
}

function blindspotTrigger(): AgentTrigger {
  return {
    id: "tr-blindspot",
    source: "materials",
    kind: "cards-published",
    data: { materialId: "m-1", cardIds: ["sc-1", "sc-2"] },
  };
}

/** 收集 Worker 途中汇报的汇。 */
const collectingSink = (reports: AgentReport[]): ReportSink => async (report) => {
  reports.push(report);
};

describe("对话不再由 Worker 接玩家的话", () => {
  it("kind chat 不调用模型,也不把回复当成一张对话工单交出去", async () => {
    const model = new FakeModelPort();
    model.enqueue("[wave]不该走到这里。");
    const worker = createModelWorkers({ routerModel: model });
    const trigger = chatTrigger("在吗");
    const report = await worker.run(ticketOf(trigger), trigger, { onReport: async () => undefined });
    expect(model.calls).toEqual([]);
    expect(report).toMatchObject({ status: "dropped" });
    expect(report.text).not.toContain("不该走到这里");
  });
});

describe("投研/盲区 Worker(工单 11,假模型端口)", () => {
  it("投研 Worker:模型起草,最终只产 waiting 草稿(人审闸门,Worker 无发布接口)", async () => {
    const model = new FakeModelPort();
    model.enqueue("本周三要点：AI 应用、消费复苏、利率窗口；风险：拥挤交易。");
    const worker = createModelWorkers({ workerModel: model });
    const trigger = researchTrigger();

    const report = await worker.run({ ...ticketOf(trigger), id: "t-research" }, trigger, { onReport: async () => undefined });

    expect(report).toMatchObject({ status: "waiting" });
    expect(report.text).toContain("本周三要点");
  });

  it("盲区 Worker:同样只产 waiting 草稿", async () => {
    const model = new FakeModelPort();
    model.enqueue("盲区一：只顾开场破冰，收口动作缺失。");
    const worker = createModelWorkers({ workerModel: model });
    const trigger = blindspotTrigger();

    const report = await worker.run({ ...ticketOf(trigger), id: "t-blindspot" }, trigger, { onReport: async () => undefined });

    expect(report).toMatchObject({ status: "waiting" });
    expect(report.text).toContain("盲区一");
  });

  it("没配模型:投研/盲区退回确定性 demo 草稿,仍是 waiting(demo 模式可完整演示)", async () => {
    const worker = createModelWorkers({});
    const research = await worker.run(
      { ...ticketOf(researchTrigger()), id: "t-research" },
      researchTrigger(),
      { onReport: async () => undefined },
    );
    const blindspot = await worker.run(
      { ...ticketOf(blindspotTrigger()), id: "t-blindspot" },
      blindspotTrigger(),
      { onReport: async () => undefined },
    );

    expect(research).toMatchObject({ status: "waiting" });
    expect(research.text).toContain("草稿");
    expect(blindspot).toMatchObject({ status: "waiting" });
    expect(blindspot.text).toContain("草稿");
  });

  it("模型出错:投研落 failed 写明原因,并退回 demo 草稿(仍 waiting)", async () => {
    const model = new FakeModelPort();
    model.error = new Error("超时");
    const worker = createModelWorkers({ workerModel: model });
    const reports: AgentReport[] = [];
    const trigger = researchTrigger();

    const report = await worker.run(
      { ...ticketOf(trigger), id: "t-research" },
      trigger,
      { onReport: collectingSink(reports) },
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("failed");
    expect(reports[0].text).toContain("超时");
    expect(report).toMatchObject({ status: "waiting" });
    expect(report.text).toContain("草稿");
  });

  it("草稿模型抛非 Error(如字符串):不二次抛错,照常落 failed(短码)并退回 demo 草稿(S5)", async () => {
    const model = new FakeModelPort();
    model.error = "boom" as unknown as Error;
    const worker = createModelWorkers({ workerModel: model });
    const reports: AgentReport[] = [];
    const trigger = researchTrigger();

    const report = await worker.run(
      { ...ticketOf(trigger), id: "t-research" },
      trigger,
      { onReport: collectingSink(reports) },
    );

    expect(reports[0].status).toBe("failed");
    expect(reports[0].text).toContain("模型调用失败");
    expect(report).toMatchObject({ status: "waiting" });
    expect(report.text).toContain("草稿");
  });
});
