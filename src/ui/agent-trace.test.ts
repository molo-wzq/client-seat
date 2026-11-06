import { describe, expect, it } from "vitest";
import type { AgentEvalRecord, AgentTicketView } from "../shared/agent-contract";
import { buildTraceSteps, mergeWorkLog } from "./agent-trace";

/**
 * 工单 15 测试缝(纯函数):轨迹归并——
 * 把账本视图(工单)与评估记录按同一触发归并成「做了什么」轨迹行与工作日志时间线。
 * 数据形状由 agent-contract 的 AgentTicketView(triggerId/worker/at)钉住。
 */

function tv(overrides: Partial<AgentTicketView> & { ticketId: string }): AgentTicketView {
  return { status: "ready", text: "", ...overrides };
}

function ev(overrides: Partial<AgentEvalRecord> & { triggerId: string }): AgentEvalRecord {
  return {
    at: "2026-11-05T09:00:00.000Z",
    ruleId: "R4",
    wouldDo: "通读到期的周报并整理本周要点",
    why: "周报到期，投研弹药要先备好",
    outcome: "executed",
    ...overrides,
  };
}

describe("buildTraceSteps(工单 15 轨迹行)", () => {
  it("对话回复:调了对话 Worker、办完了,两步", () => {
    const tickets = [tv({ ticketId: "t-chat", status: "ready", worker: "对话", triggerId: "tr-1" })];
    const steps = buildTraceSteps("t-chat", tickets, []);
    expect(steps).toEqual([
      { icon: "🔍", label: "查了对话" },
      { icon: "✅", label: "办完了" },
    ]);
  });

  it("投研草稿等拍板:查了投研 → 规则起草 → 等你拍板,与 spec 示例同一形状", () => {
    const tickets = [tv({ ticketId: "t-r", status: "waiting", worker: "投研", triggerId: "tr-9", text: "本周投研先押 AI 还是消费？" })];
    const evals = [ev({ triggerId: "tr-9" })];
    const steps = buildTraceSteps("t-r", tickets, evals);
    expect(steps.map((step) => `${step.icon} ${step.label}`)).toEqual([
      "🔍 查了投研",
      "📋 通读到期的周报并整理本周要点",
      "⏸ 等你拍板",
    ]);
    // 展开的明细:规则 id、理由、处置都在。
    expect(steps[1]?.detail).toContain("R4");
    expect(steps[1]?.detail).toContain("周报到期，投研弹药要先备好");
    expect(steps[1]?.detail).toContain("已执行");
  });

  it("observe 只记录的评估,明细写「只记录」;其余状态各有措辞", () => {
    const tickets = [
      tv({ ticketId: "t-b", status: "blocked", worker: "报错处置", triggerId: "tr-b" }),
      tv({ ticketId: "t-f", status: "failed", worker: "对话", triggerId: "tr-f" }),
      tv({ ticketId: "t-d", status: "dropped", worker: "复盘", triggerId: "tr-d" }),
      tv({ ticketId: "t-p", status: "progress", worker: "素材", triggerId: "tr-p" }),
    ];
    const evals = [ev({ triggerId: "tr-b", outcome: "observed" })];
    expect(buildTraceSteps("t-b", tickets, evals)[1]?.detail).toContain("只记录");
    expect(buildTraceSteps("t-f", tickets, []).map((step) => step.label)).toEqual(["查了对话", "没办成"]);
    expect(buildTraceSteps("t-d", tickets, []).map((step) => step.label)).toEqual(["查了复盘", "不做了"]);
    expect(buildTraceSteps("t-p", tickets, []).map((step) => step.label)).toEqual(["查了素材", "在跑"]);
  });

  it("评估按同一触发归并:别的触发的评估不进这条轨迹;未知工单号给空轨迹", () => {
    const tickets = [tv({ ticketId: "t-1", status: "ready", worker: "对话", triggerId: "tr-1" })];
    const evals = [ev({ triggerId: "tr-other" })];
    expect(buildTraceSteps("t-1", tickets, evals)).toHaveLength(2);
    expect(buildTraceSteps("t-unknown", tickets, evals)).toEqual([]);
  });

  it("工单视图缺 worker/triggerId(旧数据)也能给状态一步,不抛错", () => {
    expect(buildTraceSteps("t-old", [tv({ ticketId: "t-old", status: "waiting" })], [])).toEqual([
      { icon: "⏸", label: "等你拍板" },
    ]);
  });
});

describe("mergeWorkLog(工单 15 工作日志)", () => {
  it("工单与评估记录按时间线合并,时间相同工单在前", () => {
    const tickets = [
      tv({ ticketId: "t-2", worker: "投研", triggerId: "tr-2", at: "2026-11-05T10:00:00.000Z" }),
      tv({ ticketId: "t-1", worker: "对话", triggerId: "tr-1", at: "2026-11-05T09:00:00.000Z" }),
    ];
    const evals = [ev({ triggerId: "tr-2", at: "2026-11-05T09:30:00.000Z" })];
    const log = mergeWorkLog(tickets, evals);
    expect(log.map((item) => item.kind)).toEqual(["ticket", "eval", "ticket"]);
    expect(log[0]).toMatchObject({ kind: "ticket", ticket: { ticketId: "t-1" } });
    expect(log[1]).toMatchObject({ kind: "eval", eval: { triggerId: "tr-2" } });
    expect(log[2]).toMatchObject({ kind: "ticket", ticket: { ticketId: "t-2" } });
  });

  it("没有 at 的旧工单排最后;空输入给空日志", () => {
    const log = mergeWorkLog([tv({ ticketId: "t-x", worker: "对话" })], []);
    expect(log).toHaveLength(1);
    expect(mergeWorkLog([], [])).toEqual([]);
  });
});
