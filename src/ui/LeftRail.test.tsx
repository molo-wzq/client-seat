import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { LeftRail } from "./LeftRail";

function renderRail() {
  return render(
    <LeftRail
      view="setup"
      materialCount={1}
      cardCount={2}
      historyCount={3}
      sessionStatus={null}
      onNavigate={() => {}}
      onResumeOngoing={() => {}}
      onQuickStart={() => {}}
      quickBusy={false}
    />,
  );
}

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
