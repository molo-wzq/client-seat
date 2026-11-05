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

describe("对话 Worker(工单 11,假模型端口)", () => {
  it("回复剥掉表情前缀:emotion 落成结构化字段,正文进 ready Report", async () => {
    const model = new FakeModelPort();
    model.enqueue("[cheer]接住这波节奏，咱们稳着来。");
    const worker = createModelWorkers({ routerModel: model });

    const report = await worker.run(ticketOf(chatTrigger("这轮我接得怎么样")), chatTrigger("这轮我接得怎么样"), { onReport: async () => undefined });

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

    await worker.run(ticketOf(chatTrigger("经理刚才那句什么意思")), chatTrigger("经理刚才那句什么意思"), { onReport: async () => undefined, onDelta: (delta) => deltas.push(delta) });

    expect(deltas.join("")).toBe("我先看看经理这步棋。");
  });

  it("回复前有空白时表情标签照样剥掉:delta 不带 [cheer] 上屏,与最终 Report 一致(S3)", async () => {
    const model = new FakeModelPort();
    model.enqueue("\n[cheer]你好");
    const worker = createModelWorkers({ routerModel: model });
    const deltas: string[] = [];

    const report = await worker.run(ticketOf(chatTrigger("在吗")), chatTrigger("在吗"), { onReport: async () => undefined, onDelta: (delta) => deltas.push(delta) });

    expect(deltas.join("")).toBe("你好");
    expect(report).toMatchObject({ text: "你好", emotion: "cheer" });
  });

  it("短回复不是表情标签(如「[好]」):流结束时扣住的字符也要放出,不丢字(S3)", async () => {
    const model = new FakeModelPort();
    model.enqueue("[好]");
    const worker = createModelWorkers({ routerModel: model });
    const deltas: string[] = [];

    const report = await worker.run(ticketOf(chatTrigger("就这样办")), chatTrigger("就这样办"), { onReport: async () => undefined, onDelta: (delta) => deltas.push(delta) });

    expect(deltas.join("")).toBe("[好]");
    expect(report).toMatchObject({ text: "[好]" });
    expect(report.emotion).toBeUndefined();
  });

  it("快捷动作:玩家话里识别出命令意图转成建议,不直接执行", async () => {
    const model = new FakeModelPort();
    model.enqueue("[wave]好嘞，听你的，我陪你看。");
    const worker = createModelWorkers({ routerModel: model });
    const trigger = chatTrigger("不然换个客户，再来一局试试");

    const report = await worker.run(ticketOf(trigger), trigger, { onReport: async () => undefined });

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

    const report = await worker.run(ticketOf(trigger), trigger, { onReport: async () => undefined });

    expect([...report.text].length).toBe(120);
    expect(report.text).toBe([...longBody].slice(0, 120).join(""));
  });

  it("模型出错:落 failed 写明原因,退回 demo 回复,桌宠不卡死", async () => {
    const model = new FakeModelPort();
    model.error = new Error("网关 502");
    const worker = createModelWorkers({ routerModel: model });
    const reports: AgentReport[] = [];
    const trigger = chatTrigger("在吗");

    const report = await worker.run(ticketOf(trigger), trigger, { onReport: collectingSink(reports) });

    // 第一条是 failed(短码);demo 回退起手先模拟一次工具调用(工单 16),再出 ready。
    expect(reports[0]).toMatchObject({ ticketId: "t-chat", status: "failed" });
    expect(reports.slice(1).map((item) => item.status)).toEqual(["progress"]);
    // Report 只写分类短码(S5),原始报错不进 Report/账本/气泡。
    expect(reports[0].text).toContain("模型网关错误");
    expect(reports[0].text).not.toContain("网关 502");
    // 回退也是对话脚本:带表情、说得像桌宠,面板里看得见(工单 12)。
    expect(report).toMatchObject({ status: "ready", emotion: "wave" });
    expect(report.text).toContain("我在呢");
  });

  it("模型原始报错不进 Report(S5):failed 只写中文短码,原文(掩密钥)只进服务端日志", async () => {
    const model = new FakeModelPort();
    model.error = new Error(
      '语言模型调用失败(HTTP 500):{"error":{"message":"key sk-abc123XYZ rejected","auth":"Bearer abc.def.ghi"}}',
    );
    const worker = createModelWorkers({ routerModel: model });
    const reports: AgentReport[] = [];
    const trigger = chatTrigger("在吗");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const report = await worker.run(ticketOf(trigger), trigger, { onReport: collectingSink(reports) });

      expect(reports[0]).toMatchObject({ status: "failed" });
      expect(reports[0].text).toContain("模型网关错误");
      // 网关原始响应体(含密钥形串)不出现在任何玩家可见文本里。
      for (const raw of ["HTTP 500", "sk-abc123XYZ", "Bearer abc.def.ghi"]) {
        expect(reports[0].text).not.toContain(raw);
        expect(report.text).not.toContain(raw);
      }
      // 原文进服务端日志,但形如密钥的串已掩掉。
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("sk-***");
      expect(logged).not.toContain("sk-abc123XYZ");
      expect(logged).not.toContain("Bearer abc.def.ghi");
    } finally {
      warn.mockRestore();
    }
  });

  it("流式已开始后模型失败:demo 话术不再接在半截输出后面,直接落 failed(S2)", async () => {
    const model = new FakeModelPort();
    model.failAfter = { delta: "[wave]半截真实", error: new Error("网关 502") };
    const worker = createModelWorkers({ routerModel: model });
    const trigger = chatTrigger("在吗");
    const deltas: string[] = [];
    const reports: AgentReport[] = [];

    const report = await worker.run(ticketOf(trigger), trigger, {
      onReport: collectingSink(reports),
      onDelta: (delta) => deltas.push(delta),
    });

    // 面板收到的增量只有半截真实输出,失败后不再追加演示文本(不拼怪话)。
    expect(deltas.join("")).toBe("半截真实");
    expect(report).toMatchObject({ status: "failed" });
    // 失败即最终 Report,不先落一笔重复的途中 failed。
    expect(reports).toHaveLength(0);
  });

  it("没配模型(无 key):chat 走演示脚本——分拍流式、带表情,面板逐字可演示", async () => {
    const worker = createModelWorkers({ demoChatSleep: () => Promise.resolve() });
    const trigger = chatTrigger("陪我说说话");
    const deltas: string[] = [];

    const report = await worker.run(ticketOf(trigger), trigger, { onReport: async () => undefined, onDelta: (delta) => deltas.push(delta) });

    expect(report).toMatchObject({ status: "ready", emotion: "wave" });
    expect(deltas.length).toBeGreaterThan(1); // 分几拍流出,看得见逐字
    expect(deltas.join("")).toBe(report.text);
  });

  it("没配模型:玩家话里的命令意图照样转成快捷动作建议(点了才执行)", async () => {
    const worker = createModelWorkers({ demoChatSleep: () => Promise.resolve() });
    const trigger = chatTrigger("不然换个客户，再来一局试试");

    const report = await worker.run(ticketOf(trigger), trigger, { onReport: async () => undefined });

    expect(report.quickActions).toEqual(["换个客户", "再来一局"]);
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

describe("脱敏出口与流式事件(经核心公开接口)", () => {
  it("可注入 redact 是 delta 与 Report 的共用出口:两路文本都过同一道(S4)", async () => {
    // 服务端不再接受前端传入的 hidden 原文;需要脱敏时在组合根注入 redact。
    const model = new FakeModelPort();
    model.enqueue("[cheer]放心，卡号是 622202123456，我记下了。");
    const worker = createModelWorkers({
      routerModel: model,
      redact: (text) => text.replace(/\d/g, "●"),
    });
    const trigger = chatTrigger("跟你说个秘密");
    const deltas: string[] = [];

    const report = await worker.run(ticketOf(trigger), trigger, {
      onReport: async () => undefined,
      onDelta: (delta) => deltas.push(delta),
    });

    // 逐段 delta 与最终 Report 都不带明文数字,且走的是同一个 redact。
    expect(deltas.join("")).toBe("放心，卡号是 ●●●●●●●●●●●●，我记下了。");
    expect(report.text).toBe("放心，卡号是 ●●●●●●●●●●●●，我记下了。");
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
