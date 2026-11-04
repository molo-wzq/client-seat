import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createProductCore } from "../domain/product-core";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { InMemoryStorage } from "../product/in-process-product-api";
import { isStale, percentile, ResearchDrawer, weekNumber } from "./ResearchDrawer";
import { armedObjectionChips, getArmedObjections, objectionLine, toggleArmedObjection } from "./intel-objections";
import type { Conversation } from "../domain/types";

function renderDrawer() {
  const adapter = new FakeModelAdapter();
  const api = createProductCore({ copywriting: adapter, dialogue: adapter, storage: new InMemoryStorage() });
  return render(<ResearchDrawer api={api} />);
}

describe("投研抽屉", () => {
  it("浮层挂在页面根部，锁住背景滚动，Escape 退出后恢复焦点", async () => {
    const user = userEvent.setup();
    const { container } = renderDrawer();
    const trigger = screen.getByRole("button", { name: /宏观开场/ });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(dialog.parentElement).toHaveClass("closing");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("抽屉内点击保持打开，遮罩点击播放退出动画并关闭", async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole("button", { name: /行业轮动/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(dialog.parentElement).not.toHaveClass("closing");
    fireEvent.click(dialog.parentElement!);
    expect(dialog.parentElement).toHaveClass("closing");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("情报档案夹", () => {
  it("档案夹显示周次，翻开后四张情报卡可切换", async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole("button", { name: "翻开本周情报档案" }));
    const dialog = screen.getByRole("dialog", { name: "本周情报桌" });
    await user.click(within(dialog).getByRole("button", { name: /资产产品/ }));
    expect(within(dialog).getByRole("button", { name: /资产产品/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("超过一周未更新判为待更新；周次与分位从周报文字里读", () => {
    expect(isStale("Sat 2026-10-24 4:00 PM CST", new Date(2026, 10, 2))).toBe(true);
    expect(isStale("Sat 2026-10-24 4:00 PM CST", new Date(2026, 9, 27))).toBe(false);
    expect(weekNumber("2026年第42周投研周报")).toBe("42");
    expect(percentile("估值处于历史 41.5% 分位")).toBe(41.5);
  });
});

describe("甩给经理", () => {
  it("异议只取客户原话，经理开口后才进快捷回复，最多两句", () => {
    window.localStorage.clear();
    expect(objectionLine("客户说：「行情太差，买理财肯定亏」")).toBe("行情太差，买理财肯定亏");
    toggleArmedObjection("A");
    toggleArmedObjection("B");
    toggleArmedObjection("C");
    expect(getArmedObjections()).toEqual(["B", "C"]);
    const base = { turns: [] } as unknown as Conversation;
    expect(armedObjectionChips(base)).toEqual([]);
    const spoken = { turns: [{ number: 1, speaker: "customer", text: "B" }, { number: 2, speaker: "manager", text: "您好" }] } as unknown as Conversation;
    expect(armedObjectionChips(spoken)).toEqual(["C"]);
    window.localStorage.clear();
  });
});
