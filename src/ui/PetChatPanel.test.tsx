import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PetChatPanel, type PetChatMessage } from "./PetChatPanel";

/**
 * 工单 12 测试缝:对话面板的渲染与交互——
 * 焦点、Enter/Shift+Enter/Esc、锁定、打字指示、快捷芯片与快捷动作建议、清空。
 * 流式拼接与红点在 DeskPet 层测(见 DeskPet.test.tsx)。
 */

/** 一条消息的速记工厂。 */
function msg(speaker: PetChatMessage["speaker"], text: string, extra: Partial<PetChatMessage> = {}): PetChatMessage {
  return { key: `${speaker}-${text}`, speaker, text, ...extra };
}

function renderPanel(overrides: Partial<Parameters<typeof PetChatPanel>[0]> = {}) {
  const props = {
    messages: [] as PetChatMessage[],
    awaitingReply: false,
    inCall: false,
    onSend: vi.fn(),
    onClose: vi.fn(),
    onClear: vi.fn(),
    onQuickAction: vi.fn(),
    onOpenDemo: vi.fn(),
    ...overrides,
  };
  render(<PetChatPanel {...props} />);
  return props;
}

describe("对话面板(工单 12)", () => {
  it("打开即自动聚焦输入框", () => {
    renderPanel();
    expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveFocus();
  });

  it("Enter 发送并清空输入;Shift+Enter 只换行不发送", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const input = screen.getByRole("textbox", { name: "对话输入" });

    await user.type(input, "经理刚才那句什么意思{Enter}");
    expect(props.onSend).toHaveBeenCalledWith("经理刚才那句什么意思");
    expect(input).toHaveValue("");

    await user.type(input, "第一行{Shift>}{Enter}{/Shift}第二行");
    expect(props.onSend).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("第一行\n第二行");
  });

  it("Esc 关闭面板", () => {
    const props = renderPanel();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "对话输入" }), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("顶部一排快捷芯片:点了才执行(发命令 + 跳转回调)", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const chips = screen.getByRole("group", { name: "快捷芯片" });
    for (const label of ["换个客户", "再来一局", "上局复盘", "本周投研"]) {
      expect(chips).toHaveTextContent(label);
    }
    await user.click(screen.getByRole("button", { name: "本周投研" }));
    expect(props.onQuickAction).toHaveBeenCalledWith("本周投研");
  });

  it("消息按说话人排开;回复带的快捷动作建议渲染成按钮,点了才执行", async () => {
    const user = userEvent.setup();
    const props = renderPanel({
      messages: [
        msg("player", "换个客户试试"),
        msg("pet", "好，这就去安排。", { quickActions: ["换个客户", "再来一局"] }),
      ],
    });

    const list = screen.getByRole("log", { name: "对话记录" });
    expect(list).toHaveTextContent("换个客户试试");
    expect(list).toHaveTextContent("好，这就去安排。");
    // 建议只是建议:点之前没执行过(顶部芯片同名,只在记录里找)。
    expect(props.onQuickAction).not.toHaveBeenCalled();
    const record = screen.getByRole("log", { name: "对话记录" });
    await user.click(within(record).getByRole("button", { name: "换个客户" }));
    expect(props.onQuickAction).toHaveBeenCalledWith("换个客户");
    // 第二个建议也各点各的。
    await user.click(within(record).getByRole("button", { name: "再来一局" }));
    expect(props.onQuickAction).toHaveBeenCalledWith("再来一局");
  });

  it("等待回复时显示「…」打字指示;流式正文到达后逐字显示", () => {
    const { rerender } = render(<PetChatPanel
      messages={[msg("player", "在吗")]}
      awaitingReply
      inCall={false}
      onSend={vi.fn()}
      onClose={vi.fn()}
      onClear={vi.fn()}
      onQuickAction={vi.fn()}
      onOpenDemo={vi.fn()}
    />);
    expect(screen.getByLabelText("正在输入")).toHaveTextContent("…");

    rerender(<PetChatPanel
      messages={[msg("player", "在吗"), { key: "s", speaker: "pet", text: "我在", streaming: true }]}
      awaitingReply={false}
      inCall={false}
      onSend={vi.fn()}
      onClose={vi.fn()}
      onClear={vi.fn()}
      onQuickAction={vi.fn()}
      onOpenDemo={vi.fn()}
    />);
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("我在");
    expect(screen.queryByLabelText("正在输入")).not.toBeInTheDocument();
  });

  it("通话中输入框锁住,提示「通话中，挂断后再聊」,提交也不发送", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ inCall: true });
    const input = screen.getByRole("textbox", { name: "对话输入" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "通话中，挂断后再聊");

    // 芯片不锁(「再来一局」对局中还得能按),但输入框禁用。
    await user.click(screen.getByRole("button", { name: "再来一局" }));
    expect(props.onQuickAction).toHaveBeenCalledWith("再来一局");

    fireEvent.submit(input.closest("form")!);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("输入「演示」唤出一键演示,不作为对话发送", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "演示{Enter}");
    expect(props.onOpenDemo).toHaveBeenCalledTimes(1);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("空输入不发送;「清空」与「关闭」各有按钮", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ messages: [msg("player", "在吗"), msg("pet", "我在呢")] });
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "  {Enter}");
    expect(props.onSend).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "清空对话" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "关闭对话" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
