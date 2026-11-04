import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../server/agent/types";
import { DeskPet, type PetExpression } from "./DeskPet";
import type { AgentClient } from "./agent-client";

// 桌宠把版式、勿扰、位置都记在 localStorage,测试间互不串扰。
beforeEach(() => {
  window.localStorage.clear();
});

/** 假 agent 客户端(工单 03 测试缝):只记录 sendCommand/onEvent 的调用。 */
function fakeAgent(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    sendCommand: vi.fn(() => Promise.resolve()),
    onEvent: vi.fn(() => () => undefined),
    ...overrides,
  };
}

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

describe("桌宠快捷环与命令条(工单 03)", () => {
  it("点击头像弹出快捷环 4 项,点击项把命令发给 agent", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));

    expect(screen.getByRole("button", { name: "换个客户" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再来一局" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上局复盘" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本周投研" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "换个客户" }));
    expect(agent.sendCommand).toHaveBeenCalledWith("换个客户");
  });

  it("Ctrl+K 唤出命令条,回车发送并收起", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    expect(screen.queryByRole("textbox", { name: "命令条" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("textbox", { name: "命令条" });

    await user.type(input, "把本周投研讲成一句人话{Enter}");

    expect(agent.sendCommand).toHaveBeenCalledWith("把本周投研讲成一句人话");
    expect(screen.queryByRole("textbox", { name: "命令条" })).not.toBeInTheDocument();
  });

  it("Esc 关闭命令条且不发送", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("textbox", { name: "命令条" });
    await user.type(input, "换个客户{Escape}");

    expect(agent.sendCommand).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "命令条" })).not.toBeInTheDocument();
  });

  it("收到 pet-bubble 事件显示气泡,超 40 字截断", () => {
    let listener: ((event: AgentEvent) => void) | undefined;
    const agent = fakeAgent({
      onEvent: (l) => {
        listener = l;
        return () => undefined;
      },
    });
    render(<DeskPet agent={agent} />);

    act(() => {
      listener?.({
        type: "channel",
        channel: { target: "pet-bubble", ticketId: "t1", text: "很".repeat(50) },
      });
    });

    const bubble = screen.getByRole("status", { name: "桌宠气泡" });
    expect(bubble.textContent).toBe("很".repeat(40));
  });

  it("对局中命令条置灰禁用,提交也不发送", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} inCall />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("textbox", { name: "命令条" });
    expect(input).toBeDisabled();

    fireEvent.submit(input.closest("form")!);
    expect(agent.sendCommand).not.toHaveBeenCalled();
  });

  it("按住说话只留占位:按钮存在且禁用,不接 ASR", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const holdSpeak = screen.getByRole("button", { name: /按住说话/ });
    expect(holdSpeak).toBeDisabled();
    expect(agent.sendCommand).not.toHaveBeenCalled();
  });

  it("上一条指令还没回,仍能继续发下一条(全双工)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({ sendCommand: vi.fn(() => new Promise<void>(() => undefined)) });
    render(<DeskPet agent={agent} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await user.type(screen.getByRole("textbox", { name: "命令条" }), "把上周投研总结成一句话{Enter}");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await user.type(screen.getByRole("textbox", { name: "命令条" }), "顺便看看上局复盘{Enter}");

    expect(agent.sendCommand).toHaveBeenCalledTimes(2);
    expect(agent.sendCommand).toHaveBeenNthCalledWith(1, "把上周投研总结成一句话");
    expect(agent.sendCommand).toHaveBeenNthCalledWith(2, "顺便看看上局复盘");
  });
});
