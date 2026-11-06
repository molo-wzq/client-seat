import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentTicketView } from "../shared/agent-contract";
import { TicketCard } from "./TicketCard";

/** 工单 15 测试缝(展示组件):waiting 工单的待拍板卡与 blocked 只读卡。 */

function card(overrides: Partial<AgentTicketView> = {}): AgentTicketView {
  return { ticketId: "t-w", status: "waiting", text: "本周投研先押 AI 还是消费？等你拍板。", ...overrides };
}

describe("TicketCard(工单 15 待拍板卡)", () => {
  it("waiting 卡:显示草稿与「同意」「驳回」「改一改」,决定各走各的出口", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onRevise = vi.fn();
    render(
      <TicketCard ticket={card()} onApprove={onApprove} onReject={onReject} onRevise={onRevise} quoting={false} />,
    );

    const region = screen.getByRole("article", { name: "待拍板：本周投研先押 AI 还是消费？等你拍板。" });
    expect(region).toHaveTextContent("等你拍板");

    await user.click(screen.getByRole("button", { name: "同意" }));
    expect(onApprove).toHaveBeenCalledWith("t-w");
    await user.click(screen.getByRole("button", { name: "驳回" }));
    expect(onReject).toHaveBeenCalledWith("t-w");
    await user.click(screen.getByRole("button", { name: "改一改" }));
    expect(onRevise).toHaveBeenCalledWith("t-w");
  });

  it("改一改进入引用态:卡上标出「正在改这版」,再点一次取消", async () => {
    const user = userEvent.setup();
    const onRevise = vi.fn();
    const { rerender } = render(
      <TicketCard ticket={card()} onApprove={vi.fn()} onReject={vi.fn()} onRevise={onRevise} quoting={false} />,
    );
    await user.click(screen.getByRole("button", { name: "改一改" }));
    expect(onRevise).toHaveBeenCalledWith("t-w");

    rerender(
      <TicketCard ticket={card()} onApprove={vi.fn()} onReject={vi.fn()} onRevise={onRevise} quoting />,
    );
    expect(screen.getByRole("article", { name: /待拍板/ })).toHaveTextContent("正在改这版");
  });

  it("blocked 卡只读:受阻原因可见,没有按钮", () => {
    render(
      <TicketCard
        ticket={card({ ticketId: "t-b", status: "blocked", text: "缺素材，卡住了。" })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onRevise={vi.fn()}
        quoting={false}
      />,
    );
    const region = screen.getByRole("article", { name: "受阻：缺素材，卡住了。" });
    expect(region).toHaveTextContent("受阻");
    for (const label of ["同意", "驳回", "改一改"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("空文案给占位「刚领走，还没汇报」", () => {
    render(
      <TicketCard ticket={card({ text: "" })} onApprove={vi.fn()} onReject={vi.fn()} onRevise={vi.fn()} quoting={false} />,
    );
    expect(screen.getByText("刚领走，还没汇报")).toBeInTheDocument();
  });
});
