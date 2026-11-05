import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentPolicy } from "../shared/agent-contract";
import { PetMenu } from "./PetMenu";

/** 工单 15 测试缝(展示组件):头像下常驻按钮全删,收进面板右上「⋯」菜单(右键头像同效)。 */

function policy(acceptMode: AgentPolicy["acceptMode"]): AgentPolicy {
  return { version: 1, acceptMode, rules: [] };
}

describe("PetMenu(工单 15 ⋯ 菜单)", () => {
  it("菜单里能切换男女版、进勿扰;observe 放权档只在这里(工单 15)", async () => {
    const user = userEvent.setup();
    const onSwitchVariant = vi.fn();
    const onDnd = vi.fn();
    const onSetMode = vi.fn();
    render(
      <PetMenu
        variant="f"
        policy={policy("auto")}
        onSwitchVariant={onSwitchVariant}
        onDnd={onDnd}
        onSetMode={onSetMode}
      />,
    );

    const menu = screen.getByRole("menu", { name: "桌宠设置" });
    expect(menu).toHaveTextContent("切换男版");

    await user.click(screen.getByRole("menuitem", { name: "切换男版" }));
    expect(onSwitchVariant).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("menuitem", { name: "勿扰" }));
    expect(onDnd).toHaveBeenCalledTimes(1);

    // observe 档只在菜单里;当前 auto,观察未选中。
    const observe = screen.getByRole("menuitemcheckbox", { name: /观察模式/ });
    expect(observe).toHaveAttribute("aria-checked", "false");
    await user.click(observe);
    expect(onSetMode).toHaveBeenCalledWith("observe");
  });

  it("观察模式已开时打勾;男版时给「切换女版」", () => {
    render(
      <PetMenu variant="m" policy={policy("observe")} onSwitchVariant={vi.fn()} onDnd={vi.fn()} onSetMode={vi.fn()} />,
    );
    expect(screen.getByRole("menuitemcheckbox", { name: /观察模式/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitem", { name: "切换女版" })).toBeInTheDocument();
  });
});
