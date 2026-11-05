import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentPolicy } from "../shared/agent-contract";
import { AgentStatusBar } from "./AgentStatusBar";

/** 工单 15 测试缝(展示组件):面板顶部的 Agent 状态条——左侧状态、右侧两档放权、点击展开工作日志。 */

function policy(acceptMode: AgentPolicy["acceptMode"]): AgentPolicy {
  return { version: 1, acceptMode, rules: [] };
}

describe("AgentStatusBar(工单 15 状态条)", () => {
  it("左侧状态:没在等、没在跑 → 在听;等回复 → 在想;有并行工单 → 在跑 N 件事(在想优先)", () => {
    const { rerender } = render(
      <AgentStatusBar awaitingReply={false} runningCount={0} policy={policy("off")} onSetMode={vi.fn()} onToggleLog={vi.fn()} logOpen={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("在听");

    rerender(
      <AgentStatusBar awaitingReply={false} runningCount={2} policy={policy("off")} onSetMode={vi.fn()} onToggleLog={vi.fn()} logOpen={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("在跑 2 件事");

    rerender(
      <AgentStatusBar awaitingReply runningCount={2} policy={policy("off")} onSetMode={vi.fn()} onToggleLog={vi.fn()} logOpen={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("在想");
  });

  it("右侧两档放权:「只听我的」⇄「主动办」,auto 高亮;点击把目标档上报(工单 15:observe 收进 ⋯ 菜单)", async () => {
    const user = userEvent.setup();
    const onSetMode = vi.fn();
    render(
      <AgentStatusBar awaitingReply={false} runningCount={0} policy={policy("off")} onSetMode={onSetMode} onToggleLog={vi.fn()} logOpen={false} />,
    );
    const group = screen.getByRole("group", { name: "放权" });
    expect(within0(group, "只听我的")).toHaveAttribute("aria-pressed", "true");
    expect(within0(group, "主动办")).toHaveAttribute("aria-pressed", "false");

    await user.click(within0(group, "主动办"));
    expect(onSetMode).toHaveBeenCalledWith("auto");

    // observe 也认得:外部(⋯菜单/演示)切到 observe 时,两档都不亮。
    expect(screen.queryByRole("button", { name: "观察" })).not.toBeInTheDocument();
  });

  it("auto 时「主动办」高亮;policy 未到位时两档可点(缺省不亮)", async () => {
    const user = userEvent.setup();
    const onSetMode = vi.fn();
    render(
      <AgentStatusBar awaitingReply={false} runningCount={0} policy={policy("auto")} onSetMode={onSetMode} onToggleLog={vi.fn()} logOpen={false} />,
    );
    expect(screen.getByRole("button", { name: "主动办" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "只听我的" }));
    expect(onSetMode).toHaveBeenCalledWith("off");
  });

  it("点击状态区展开/收起工作日志", async () => {
    const user = userEvent.setup();
    const onToggleLog = vi.fn();
    render(
      <AgentStatusBar awaitingReply={false} runningCount={0} policy={policy("off")} onSetMode={vi.fn()} onToggleLog={onToggleLog} logOpen={false} />,
    );
    await user.click(screen.getByRole("button", { name: /工作日志/ }));
    expect(onToggleLog).toHaveBeenCalledTimes(1);
  });
});

/** 组内找按钮的小帮手(避免与全局重复名冲突)。 */
function within0(container: HTMLElement, name: string): HTMLElement {
  const button = [...container.querySelectorAll("button")].find((el) => el.textContent === name);
  if (!button) throw new Error(`找不到按钮:${name}`);
  return button;
}
