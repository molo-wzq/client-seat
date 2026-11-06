import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentEvalRecord, AgentTicketView } from "../shared/agent-contract";
import type { WorkLogItem } from "./agent-trace";
import { WorkLog } from "./WorkLog";

/** 工单 15 测试缝(展示组件):工作日志时间线——工单与评估记录按时间合并展示。 */

function ticketItem(overrides: Partial<AgentTicketView> & { ticketId: string }): WorkLogItem {
  return {
    at: "2026-11-05T10:00:00.000Z",
    kind: "ticket",
    ticket: { status: "waiting", text: "", worker: "投研", at: "2026-11-05T10:00:00.000Z", ...overrides },
  };
}

function evalItem(overrides: Partial<AgentEvalRecord> & { triggerId: string }): WorkLogItem {
  return {
    at: "2026-11-05T10:05:00.000Z",
    kind: "eval",
    eval: {
      at: "2026-11-05T10:05:00.000Z",
      ruleId: "R4",
      wouldDo: "通读到期的周报并整理本周要点",
      why: "周报到期，投研弹药要先备好",
      outcome: "executed",
      ...overrides,
    },
  };
}

describe("WorkLog(工单 15 工作日志)", () => {
  it("时间线合并:工单行带状态徽标、Worker 名与最新汇报;评估行带规则、研判与处置", () => {
    render(
      <WorkLog
        items={[
          ticketItem({ ticketId: "t-1", status: "waiting", text: "本周投研先押 AI 还是消费？", worker: "投研" }),
          evalItem({ triggerId: "tr-1" }),
        ]}
      />,
    );
    const log = screen.getByRole("log", { name: "工作日志" });
    expect(log).toHaveTextContent("等待");
    expect(log).toHaveTextContent("投研");
    expect(log).toHaveTextContent("本周投研先押 AI 还是消费？");
    expect(log).toHaveTextContent("R4");
    expect(log).toHaveTextContent("通读到期的周报并整理本周要点");
    expect(log).toHaveTextContent("周报到期，投研弹药要先备好");
    expect(log).toHaveTextContent("已执行");
  });

  it("空日志给空态文案;定位的工单高亮(data-highlight)", () => {
    const { rerender } = render(<WorkLog items={[]} />);
    expect(screen.getByText("还没有动静")).toBeInTheDocument();

    rerender(<WorkLog items={[ticketItem({ ticketId: "t-1" })]} highlightTicketId="t-1" />);
    expect(screen.getByRole("article", { name: /等待/ })).toHaveAttribute("data-highlight", "true");
  });

  it("没有 at 的旧工单不显示时间;空汇报给占位文案", () => {
    render(<WorkLog items={[ticketItem({ ticketId: "t-old", text: "", at: undefined })]} />);
    const row = screen.getByRole("article", { name: /等待/ });
    expect(row).toHaveTextContent("刚领走，还没汇报");
    expect(row.querySelector(".desk-pet-log-time")).toBeNull();
  });
});
