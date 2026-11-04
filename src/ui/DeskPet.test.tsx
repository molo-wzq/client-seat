import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { DeskPet, type PetExpression } from "./DeskPet";

// 桌宠把版式、勿扰、位置都记在 localStorage,测试间互不串扰。
beforeEach(() => {
  window.localStorage.clear();
});

describe("桌宠外壳", () => {
  it("默认渲染女版桌宠", () => {
    render(<DeskPet />);
    expect(screen.getByRole("img", { name: /女版/ })).toHaveAttribute(
      "src",
      expect.stringContaining("f-wave"),
    );
  });

  it("可切换男版并记住选择", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DeskPet />);
    await user.click(screen.getByRole("button", { name: "切换男版" }));
    expect(screen.getByRole("img", { name: /男版/ })).toHaveAttribute(
      "src",
      expect.stringContaining("m-wave"),
    );
    expect(window.localStorage.getItem("desk-pet-variant")).toBe("m");
    unmount();
    render(<DeskPet />);
    expect(screen.getByRole("img", { name: /男版/ })).toHaveAttribute(
      "src",
      expect.stringContaining("m-wave"),
    );
  });

  it("expression 属性切换 5 种表情图", () => {
    const cases: Array<[PetExpression, string]> = [
      ["wave", "f-wave"],
      ["think", "f-think"],
      ["cheer", "f-cheer"],
      ["sleepy", "f-sleepy"],
      ["pout", "f-pout"],
    ];
    for (const [expression, asset] of cases) {
      const { unmount } = render(<DeskPet expression={expression} />);
      expect(screen.getByRole("img", { name: /女版/ })).toHaveAttribute(
        "src",
        expect.stringContaining(asset),
      );
      unmount();
    }
  });

  it("勿扰模式收起为小圆钮，点击可恢复", async () => {
    const user = userEvent.setup();
    render(<DeskPet />);
    await user.click(screen.getByRole("button", { name: "勿扰" }));
    expect(screen.queryByRole("img", { name: /女版/ })).not.toBeInTheDocument();
    const restore = screen.getByRole("button", { name: "桌宠勿扰中,点击恢复" });
    expect(restore).toHaveClass("desk-pet-restore");
    await user.click(restore);
    expect(screen.getByRole("img", { name: /女版/ })).toBeInTheDocument();
  });

  it("拖动后位置被记住", () => {
    const { unmount } = render(<DeskPet />);
    const pet = screen.getByRole("complementary", { name: "桌宠" });
    expect(pet.style.left).toBe("");
    fireEvent.pointerDown(screen.getByRole("img", { name: /女版/ }), { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 340, clientY: 460 });
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 340, clientY: 460 });
    expect(pet.style.left).toBe("40px");
    expect(pet.style.top).toBe("60px");
    expect(window.localStorage.getItem("desk-pet-pos")).toBe(JSON.stringify({ left: 40, top: 60 }));
    unmount();
    render(<DeskPet />);
    const petAgain = screen.getByRole("complementary", { name: "桌宠" });
    expect(petAgain.style.left).toBe("40px");
    expect(petAgain.style.top).toBe("60px");
  });

  it("respect prefers-reduced-motion：关闭待机小动作", () => {
    const { unmount } = render(<DeskPet />);
    expect(screen.getByRole("complementary", { name: "桌宠" })).not.toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
    unmount();

    // jsdom 没有 matchMedia,打一个只回答 reduce 的桩,测完即还原。
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
    })) as unknown as typeof window.matchMedia;
    try {
      render(<DeskPet />);
      expect(screen.getByRole("complementary", { name: "桌宠" })).toHaveAttribute(
        "data-reduced-motion",
        "true",
      );
    } finally {
      window.matchMedia = original;
    }
  });
});
