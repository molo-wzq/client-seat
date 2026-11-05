import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PetChatPanel } from "./PetChatPanel";
import type { PetChatMessage } from "./chat-history";
import type { AgentPolicy, AgentTicketView } from "../shared/agent-contract";

/**
 * 工单 12/15 测试缝:桌宠唯一面板的渲染与交互——
 * 焦点、Enter/Shift+Enter/Esc、输入法组字、待拍板卡、引用条批注、⋯ 菜单、工作日志。
 * 流式拼接与红点在 DeskPet 层测(见 DeskPet.test.tsx);状态条细节见 AgentStatusBar.test。
 */

/** 一条消息的速记工厂。 */
function msg(speaker: PetChatMessage["speaker"], text: string, extra: Partial<PetChatMessage> = {}): PetChatMessage {
  return { key: `${speaker}-${text}`, speaker, text, ...extra };
}

/** 一张工单的速记工厂。 */
function tv(ticketId: string, status: AgentTicketView["status"], text: string): AgentTicketView {
  return { ticketId, status, text };
}

const noop = () => undefined;

function baseProps(overrides: Partial<Parameters<typeof PetChatPanel>[0]> = {}) {
  return {
    messages: [] as PetChatMessage[],
    awaitingReply: false,
    tickets: [] as AgentTicketView[],
    annotating: null as string | null,
    policy: { version: 1, acceptMode: "off", rules: [] } as AgentPolicy,
    runningCount: 0,
    variant: "f" as const,
    menuOpen: false,
    logOpen: false,
    workLog: [],
    traces: [],
    onSend: vi.fn(),
    onClose: vi.fn(),
    onClear: vi.fn(),
    onQuickAction: vi.fn(),
    onLocateTicket: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onRevise: vi.fn(),
    onSetMode: vi.fn(),
    onToggleMenu: vi.fn(),
    onSwitchVariant: vi.fn(),
    onDnd: vi.fn(),
    onToggleLog: vi.fn(),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof PetChatPanel>[0]> = {}) {
  const props = baseProps(overrides);
  render(<PetChatPanel {...props} />);
  return props;
}

describe("对话面板(工单 12/15)", () => {
  it("打开即自动聚焦输入框", () => {
    renderPanel();
    expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveFocus();
  });

  it("Enter 发送并清空输入;Shift+Enter 只换行不发送;空输入不发送", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const input = screen.getByRole("textbox", { name: "对话输入" });

    await user.type(input, "经理刚才那句什么意思{Enter}");
    expect(props.onSend).toHaveBeenCalledWith("经理刚才那句什么意思");
    expect(input).toHaveValue("");

    await user.type(input, "第一行{Shift>}{Enter}{/Shift}第二行");
    expect(props.onSend).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("第一行\n第二行");

    // 清空后:纯空白与完全空都不发送。
    await user.clear(input);
    await user.type(input, "  {Enter}");
    fireEvent.submit(input.closest("form")!);
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it("Esc 挂在面板根上:焦点在按钮上也能关;组字期放行给输入法(审查 B2/S7)", () => {
    const props = renderPanel();
    fireEvent.keyDown(screen.getByRole("region", { name: "对话面板" }), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("region", { name: "对话面板" }), { key: "Escape", isComposing: true });
    expect(props.onClose).toHaveBeenCalledTimes(1); // 组字期不关
  });

  it("中文输入法组字时按 Enter 不发送(审查 B2,工单 15 验收)", () => {
    const props = renderPanel();
    const input = screen.getByRole("textbox", { name: "对话输入" });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("空对话显示 2 个开场建议:点击即作为一句话发出(工单 15:固定芯片已删)", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const suggestions = within(screen.getByRole("group", { name: "开场建议" })).getAllByRole("button");
    expect(suggestions).toHaveLength(2);
    await user.click(suggestions[0]!);
    expect(props.onSend).toHaveBeenCalledWith(suggestions[0]!.textContent);
  });

  it("有对话后不再显示开场建议,只留模型本轮给出的建议动作(工单 15)", () => {
    renderPanel({
      messages: [
        msg("player", "在吗"),
        msg("pet", "我在呢。", { quickActions: ["本周投研"] }),
      ],
    });
    expect(screen.queryByRole("group", { name: "开场建议" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "快捷芯片" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("log", { name: "对话记录" })).getByRole("button", { name: "本周投研" }),
    ).toBeInTheDocument();
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
    expect(props.onQuickAction).not.toHaveBeenCalled();
    await user.click(within(list).getByRole("button", { name: "换个客户" }));
    expect(props.onQuickAction).toHaveBeenCalledWith("换个客户");
    await user.click(within(list).getByRole("button", { name: "再来一局" }));
    expect(props.onQuickAction).toHaveBeenCalledWith("再来一局");
  });

  it("等待回复时显示「…」;流式正文开始上屏后「…」让位", () => {
    const streaming = { key: "s", speaker: "pet" as const, text: "我在", streaming: true };
    const { rerender } = render(<PetChatPanel {...baseProps({ messages: [msg("player", "在吗")], awaitingReply: true })} />);
    expect(screen.getByLabelText("正在输入")).toHaveTextContent("…");

    rerender(<PetChatPanel {...baseProps({ messages: [msg("player", "在吗"), streaming], awaitingReply: true })} />);
    expect(screen.queryByLabelText("正在输入")).not.toBeInTheDocument();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("我在");
  });

  it("waiting 工单以待拍板卡插进对话流:同意/驳回/改一改各走各的出口(工单 15)", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ tickets: [tv("t-w", "waiting", "本周投研先押 AI 还是消费？")] });
    const list = screen.getByRole("log", { name: "对话记录" });
    expect(list).toHaveTextContent("本周投研先押 AI 还是消费？");

    await user.click(within(list).getByRole("button", { name: "同意" }));
    expect(props.onApprove).toHaveBeenCalledWith("t-w");
    await user.click(within(list).getByRole("button", { name: "驳回" }));
    expect(props.onReject).toHaveBeenCalledWith("t-w");
    await user.click(within(list).getByRole("button", { name: "改一改" }));
    expect(props.onRevise).toHaveBeenCalledWith("t-w");
  });

  it("blocked 工单以只读提示卡显示原因,没有按钮(工单 15)", () => {
    renderPanel({ tickets: [tv("t-b", "blocked", "缺素材，卡住了。")] });
    expect(screen.getByRole("article", { name: "受阻：缺素材，卡住了。" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "同意" })).not.toBeInTheDocument();
  });

  it("引用态:输入框上方出现引用条,发送按钮变「发批注」,取消走 onRevise(工单 15)", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ tickets: [tv("t-w", "waiting", "开头一句改得口语一点?")], annotating: "t-w" });
    // 草稿文案出现两处:待拍板卡 + 引用条。
    expect(screen.getAllByText("开头一句改得口语一点?")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "取消批注" })).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "对话输入" });
    expect(input).toHaveAttribute("placeholder", "说一句,这条工单就按它改");
    expect(screen.getByRole("button", { name: "发批注" })).toBeInTheDocument();
    // 发出的话照常走 onSend(上层当作批注路由),面板不识别命令词(工单 15)。
    await user.type(input, "就按这个改{Enter}");
    expect(props.onSend).toHaveBeenCalledWith("就按这个改");

    await user.click(screen.getByRole("button", { name: "取消批注" }));
    expect(props.onRevise).toHaveBeenCalledWith("t-w");
  });

  it("⋯ 菜单与工作日志:菜单打开时能切换男女/勿扰/观察档,日志区按 logOpen 显隐", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ menuOpen: true, logOpen: true });
    const menu = screen.getByRole("menu", { name: "桌宠设置" });
    expect(menu).toHaveTextContent("切换男版");

    await user.click(screen.getByRole("menuitem", { name: "切换男版" }));
    expect(props.onSwitchVariant).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("menuitem", { name: "勿扰" }));
    expect(props.onDnd).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("menuitemcheckbox", { name: /观察模式/ }));
    expect(props.onSetMode).toHaveBeenCalledWith("observe");

    expect(screen.getByRole("log", { name: "工作日志" })).toBeInTheDocument();
    expect(screen.getByText("还没有动静")).toBeInTheDocument();
  });

  it("状态条:在想时状态区显示「在想」(细节见 AgentStatusBar.test)", () => {
    renderPanel({ awaitingReply: true, runningCount: 2 });
    expect(screen.getByText("在想")).toBeInTheDocument();
  });

  it("「清空」与「关闭」各有按钮", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ messages: [msg("player", "在吗"), msg("pet", "我在呢")] });
    await user.click(screen.getByRole("button", { name: "清空对话" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "关闭对话" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("空对话给开场文案", () => {
    renderPanel();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent(/随时叫我/);
  });
});

describe("/ 命令补全(工单 15)", () => {
  it("输入 / 弹出命令候选:前缀过滤、上下键选择、Enter 确认执行动作并清空输入", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const input = screen.getByRole("textbox", { name: "对话输入" });

    await user.type(input, "/");
    let options = within(screen.getByRole("listbox", { name: "命令补全" })).getAllByRole("option");
    expect(options).toHaveLength(4);

    await user.type(input, "再来");
    options = within(screen.getByRole("listbox", { name: "命令补全" })).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("/再来一局");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    // 打全部命令字:上下键轮换,Enter 确认的是选中项(第二项 /复盘 → 上局复盘)。
    await user.clear(input);
    await user.type(input, "/");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const selected = within(screen.getByRole("listbox", { name: "命令补全" })).getAllByRole("option")[1];
    expect(selected).toHaveTextContent("/复盘");
    expect(selected).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onQuickAction).toHaveBeenCalledWith("上局复盘");
    expect(input).toHaveValue("");
  });

  it("点击候选项同样执行;Esc 只关补全不关面板(工单 15)", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const input = screen.getByRole("textbox", { name: "对话输入" });

    await user.type(input, "/换");
    await user.click(screen.getByRole("option", { name: "/换客户" }));
    expect(props.onQuickAction).toHaveBeenCalledWith("换个客户");
    expect(input).toHaveValue("");

    await user.type(input, "/");
    expect(screen.getByRole("listbox", { name: "命令补全" })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "命令补全" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
  });

  it("补全关掉后,手输整句命令回车照样执行;「/ 命令 + 正文」只当普通一句话(工单 15)", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const input = screen.getByRole("textbox", { name: "对话输入" });

    await user.type(input, "/再来一局");
    fireEvent.keyDown(input, { key: "Escape" }); // 关掉补全,只留正文
    await user.type(input, "{Enter}");
    expect(props.onQuickAction).toHaveBeenCalledWith("再来一局");
    expect(props.onSend).not.toHaveBeenCalled();

    await user.type(input, "/投研 顺便看看上周的{Enter}");
    expect(props.onSend).toHaveBeenCalledWith("/投研 顺便看看上周的");
    expect(props.onQuickAction).toHaveBeenCalledTimes(1);
  });
});

describe("Agent 轨迹行与工单定位(工单 15)", () => {
  const traceSteps = [
    { icon: "🔍", label: "查了投研" },
    { icon: "📋", label: "起草工单", detail: "R4 · 周报到期，投研弹药要先备好 · 已执行" },
    { icon: "⏸", label: "等你拍板" },
  ];

  it("桌宠回复上方有可折叠「做了什么」:默认收起一行步骤,展开见评估明细", async () => {
    const user = userEvent.setup();
    renderPanel({
      messages: [msg("player", "帮我整理投研"), msg("pet", "草稿拟好了，等你拍板。", { ticketId: "t-r" })],
      traces: [{ ticketId: "t-r", steps: traceSteps }],
    });
    const list = screen.getByRole("log", { name: "对话记录" });
    const toggle = within(list).getByRole("button", { name: /做了什么/ });
    expect(toggle).toHaveTextContent("🔍 查了投研");
    expect(toggle).toHaveTextContent("⏸ 等你拍板");
    expect(within(list).queryByText(/R4/)).not.toBeInTheDocument();

    await user.click(toggle);
    expect(within(list).getByText(/R4 · 周报到期/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(within(list).queryByText(/R4/)).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("回复里的工单可点开:「看工单」把工单号报给上层定位到工作日志", async () => {
    const props = renderPanel({
      messages: [msg("pet", "办好了。", { ticketId: "t-1" })],
      traces: [{ ticketId: "t-1", steps: [{ icon: "✅", label: "办完了" }] }],
    });
    await userEvent.click(screen.getByRole("button", { name: "看工单" }));
    expect(props.onLocateTicket).toHaveBeenCalledWith("t-1");
  });

  it("没有轨迹数据的回复(工单不在账本视图里)不显示轨迹行", () => {
    renderPanel({ messages: [msg("pet", "网络不顺…", { ticketId: "t-gone" })] });
    expect(screen.queryByRole("button", { name: /做了什么/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "看工单" })).not.toBeInTheDocument();
  });
});
