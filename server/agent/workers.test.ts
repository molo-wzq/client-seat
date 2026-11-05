import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentReport, AgentTicket, AgentTrigger } from "./types";
import { createAgentCore, type ReportSink } from "./core";
import { createModelWorkers, type AgentModelMessage, type AgentModelPort } from "./workers";
import { InMemoryLedgerStorage } from "./storage";

/**
 * 真实模型 Worker(工单 11)约定测试缝:一律用假模型端口,不发网络请求。
 * - 对话 Worker:流式 delta、表情标签剥离、快捷动作建议、120 字截断、出错回退 demo 且 Report=failed;
 * - 投研/盲区 Worker:只产出 waiting 草稿,人审闸门不变(ADR 0007),Worker 手上没有任何发布接口;
 * - 隔离:hidden 条目原文不进入对话 Worker 落账的任何 Report 字段
 *   (经理侧提示词的隔离由 prompts.test.ts 既有用例钉住,这里只钉新增路径)。
 */

/** 假模型端口:排队回放预设回复,逐字流式回调;置 error 可模拟网关故障。 */
class FakeModelPort implements AgentModelPort {
  readonly calls: Array<{ messages: AgentModelMessage[] }> = [];
  private readonly queue: string[] = [];
  error: Error | null = null;

  enqueue(reply: string): void {
    this.queue.push(reply);
  }

  async completeStream(
    messages: AgentModelMessage[],
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    this.calls.push({ messages: messages.map((message) => ({ ...message })) });
    if (this.error) throw this.error;
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

describe("对话 Worker(工单 11,假模型端口)", () => {
  it("回复剥掉表情前缀:emotion 落成结构化字段,正文进 ready Report", async () => {
    const model = new FakeModelPort();
    model.enqueue("[cheer]接住这波节奏，咱们稳着来。");
    const worker = createModelWorkers({ routerModel: model });

    const report = await worker.run(ticketOf(chatTrigger("这轮我接得怎么样")), chatTrigger("这轮我接得怎么样"), async () => undefined);

    expect(report).toMatchObject({
      status: "ready",
      text: "接住这波节奏，咱们稳着来。",
      emotion: "cheer",
    });
  });

  it("流式增量经 onDelta 转发:表情前缀扣住不上屏,拼起来正是正文", async () => {
    const model = new FakeModelPort();
    model.enqueue("[think]我先看看经理这步棋。");
    const worker = createModelWorkers({ routerModel: model });
    const deltas: string[] = [];

    await worker.run(ticketOf(chatTrigger("经理刚才那句什么意思")), chatTrigger("经理刚才那句什么意思"), async () => undefined, (delta) => deltas.push(delta));

    expect(deltas.join("")).toBe("我先看看经理这步棋。");
  });

  it("快捷动作:玩家话里识别出命令意图转成建议,不直接执行", async () => {
    const model = new FakeModelPort();
    model.enqueue("[wave]好嘞，听你的，我陪你看。");
    const worker = createModelWorkers({ routerModel: model });
    const trigger = chatTrigger("不然换个客户，再来一局试试");

    const report = await worker.run(ticketOf(trigger), trigger, async () => undefined);

    expect(report.quickActions).toEqual(["换个客户", "再来一局"]);
    // 是建议不是执行:回复仍是模型对话原文,而不是快捷命令的脚本答复。
    expect(report.text).toBe("好嘞，听你的，我陪你看。");
  });

  it("单条回复硬上限 120 字:超出截断(气泡 40 字由核心另截)", async () => {
    const model = new FakeModelPort();
    const longBody = "稳".repeat(200);
    model.enqueue(`[think]${longBody}`);
    const worker = createModelWorkers({ routerModel: model });
    const trigger = chatTrigger("多说点");

    const report = await worker.run(ticketOf(trigger), trigger, async () => undefined);

    expect([...report.text].length).toBe(120);
    expect(report.text).toBe([...longBody].slice(0, 120).join(""));
  });

  it("模型出错:落 failed 写明原因,退回 demo 回复,桌宠不卡死", async () => {
    const model = new FakeModelPort();
    model.error = new Error("网关 502");
    const worker = createModelWorkers({ routerModel: model });
    const reports: AgentReport[] = [];
    const trigger = chatTrigger("在吗");

    const report = await worker.run(ticketOf(trigger), trigger, collectingSink(reports));

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ ticketId: "t-chat", status: "failed" });
    expect(reports[0].text).toContain("网关 502");
    expect(report).toMatchObject({ status: "ready", text: "收到，马上办" });
  });

  it("没配模型(无 key):chat 直接走 demo 回复,演示不断", async () => {
    const worker = createModelWorkers({});
    const trigger = chatTrigger("陪我说说话");

    const report = await worker.run(ticketOf(trigger), trigger, async () => undefined);

    expect(report).toMatchObject({ status: "ready", text: "收到，马上办" });
  });
});

describe("投研/盲区 Worker(工单 11,假模型端口)", () => {
  it("投研 Worker:模型起草,最终只产 waiting 草稿(人审闸门,Worker 无发布接口)", async () => {
    const model = new FakeModelPort();
    model.enqueue("本周三要点：AI 应用、消费复苏、利率窗口；风险：拥挤交易。");
    const worker = createModelWorkers({ workerModel: model });
    const trigger = researchTrigger();

    const report = await worker.run({ ...ticketOf(trigger), id: "t-research" }, trigger, async () => undefined);

    expect(report).toMatchObject({ status: "waiting" });
    expect(report.text).toContain("本周三要点");
  });

  it("盲区 Worker:同样只产 waiting 草稿", async () => {
    const model = new FakeModelPort();
    model.enqueue("盲区一：只顾开场破冰，收口动作缺失。");
    const worker = createModelWorkers({ workerModel: model });
    const trigger = blindspotTrigger();

    const report = await worker.run({ ...ticketOf(trigger), id: "t-blindspot" }, trigger, async () => undefined);

    expect(report).toMatchObject({ status: "waiting" });
    expect(report.text).toContain("盲区一");
  });

  it("没配模型:投研/盲区退回确定性 demo 草稿,仍是 waiting(demo 模式可完整演示)", async () => {
    const worker = createModelWorkers({});
    const research = await worker.run(
      { ...ticketOf(researchTrigger()), id: "t-research" },
      researchTrigger(),
      async () => undefined,
    );
    const blindspot = await worker.run(
      { ...ticketOf(blindspotTrigger()), id: "t-blindspot" },
      blindspotTrigger(),
      async () => undefined,
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
      collectingSink(reports),
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("failed");
    expect(reports[0].text).toContain("超时");
    expect(report).toMatchObject({ status: "waiting" });
    expect(report.text).toContain("草稿");
  });
});

describe("隔离与流式事件(工单 11,经核心公开接口)", () => {
  it("hidden 原文不落账:模型复读玩家秘密,对话 Worker 写进账本的 Report 也要抹掉", async () => {
    const hidden = "其实我私房钱有五十万";
    const model = new FakeModelPort();
    model.enqueue(`[cheer]放心，${hidden}，我记下了。`);
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: createModelWorkers({ routerModel: model }),
    });

    await core.emitTrigger({
      source: "pet",
      kind: "chat",
      data: { text: "跟你说个秘密", hidden: [hidden] },
    });

    const reportTexts = (await core.ledger())
      .filter((entry) => entry.type === "report")
      .map((entry) => JSON.stringify(entry));
    expect(reportTexts.length).toBeGreaterThan(0);
    for (const text of reportTexts) expect(text).not.toContain(hidden);
  });

  it("订阅者收到 delta 事件(ticketId + 文本片段),结束后 Report ready", async () => {
    const model = new FakeModelPort();
    model.enqueue("[wave]来了来了，我听着呢。");
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: createModelWorkers({ routerModel: model }),
    });
    const events: AgentEvent[] = [];
    core.subscribe((event) => events.push(event));

    await core.emitTrigger({ source: "pet", kind: "chat", data: { text: "在吗" } });

    const deltas = events.filter((event) => event.type === "delta");
    expect(deltas.map((event) => (event as Extract<AgentEvent, { type: "delta" }>).text).join("")).toBe(
      "来了来了，我听着呢。",
    );
    // 结束时 Report ready(deltas 全部先于最终 Report 与气泡 channel 事件)。
    const reportEvent = [...events].reverse().find(
      (event) => event.type === "report",
    ) as Extract<AgentEvent, { type: "report" }>;
    expect(reportEvent.report.status).toBe("ready");
    for (const delta of deltas) {
      expect(delta).toMatchObject({ ticketId: reportEvent.report.ticketId });
    }
  });
});
