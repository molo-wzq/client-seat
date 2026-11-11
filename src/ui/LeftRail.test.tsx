import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { LeftRail } from "./LeftRail";

function renderRail(onNavigate: (view: string) => void = () => {}) {
  return render(
    <LeftRail
      view="setup"
      materialCount={1}
      cardCount={2}
      roleCount={2}
      historyCount={3}
      sessionStatus={null}
      onNavigate={onNavigate}
      onResumeOngoing={() => {}}
      onQuickStart={() => {}}
      quickBusy={false}
    />,
  );
}

describe("手机抽屉(手机适配)", () => {
  it("点「菜单」打开抽屉,点导航项后跳转并自动收起", async () => {
    const user = userEvent.setup();
    const navigated: string[] = [];
    const { container } = renderRail((view) => navigated.push(view));
    const rail = container.querySelector(".left-rail")!;
    const menu = screen.getByRole("button", { name: "菜单" });
    expect(menu).toHaveAttribute("aria-expanded", "false");

    await user.click(menu);
    expect(rail).toHaveAttribute("data-drawer-open", "true");
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
    expect(document.documentElement.dataset.railDrawer).toBe("open");

    await user.click(screen.getByRole("button", { name: "素材库(1)" }));
    expect(navigated).toEqual(["materials"]);
    expect(rail).not.toHaveAttribute("data-drawer-open");
    expect(document.documentElement.dataset.railDrawer).toBeUndefined();
  });

  it("点遮罩或按 Esc 收起;切音效不收起", async () => {
    const user = userEvent.setup();
    const { container } = renderRail();
    const rail = container.querySelector(".left-rail")!;

    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.click(screen.getByRole("button", { name: "音效开关" }));
    expect(rail).toHaveAttribute("data-drawer-open", "true");

    await user.click(screen.getByRole("button", { name: "关闭菜单" }));
    expect(rail).not.toHaveAttribute("data-drawer-open");

    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.keyboard("{Escape}");
    expect(rail).not.toHaveAttribute("data-drawer-open");
  });
});

describe("左栏音效开关", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认开启,点击后关闭并持久化", async () => {
    const user = userEvent.setup();
    renderRail();

    const toggle = screen.getByRole("button", { name: "音效开关" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("duilian-sfx")).toBe("0");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("duilian-sfx")).toBe("1");
  });

  it("进入页面时读取上次的音效选择", () => {
    window.localStorage.setItem("duilian-sfx", "0");
    renderRail();
    expect(screen.getByRole("button", { name: "音效开关" })).toHaveAttribute("aria-pressed", "false");
  });
});
