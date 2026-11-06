import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEvalRecord,
  AgentEvent,
  AgentPolicy,
  AgentTicketView,
  EmitOutcome,
} from "../shared/agent-contract";
import { DeskPet, type DeskPetHandle } from "./DeskPet";
import { IDLE_SLEEP_MS, POKE_LINES } from "./pet-reactions";
import { AVATAR_CLICK_DELAY_MS, BUBBLE_HOLD_MS } from "./use-pet-mood";
import type { AgentClient } from "./agent-client";
import type { Conversation } from "../domain/types";
import { SEED_PRODUCT_CARD } from "../domain/seed";

// 桌宠把版式、位置、对话历史都记在 localStorage,测试间互不串扰。
beforeEach(() => {
  window.localStorage.clear();
});

/** 假 agent 客户端(工单 03 测试缝):记录各接口调用;放权与评估缺省给空实现。 */
function fakeAgent(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    sendCommand: vi.fn(() => Promise.resolve()),
    sendTrigger: vi.fn(() =>
      Promise.resolve({
        triggerId: "tr-x",
        admitted: true,
        ticket: { id: "t-x", triggerId: "tr-x", thread: { kind: "commandId" as const, key: "tr-x" } },
        report: null,
      }),
    ),
    onEvent: vi.fn(() => () => undefined),
    tickets: vi.fn(() => Promise.resolve([])),
    policy: vi.fn(() => Promise.resolve(emptyPolicy("observe"))),
    setAcceptMode: vi.fn((mode: AgentPolicy["acceptMode"]) => Promise.resolve(emptyPolicy(mode))),
    evals: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
}

/** 空规则策略样例:UI 只关心版本与当前模式,规则数据由服务端契约钉住。 */
function emptyPolicy(acceptMode: AgentPolicy["acceptMode"]): AgentPolicy {
  return { version: 1, acceptMode, rules: [] };
}

/** 捕获事件监听器的假 agent:流式、红点、工单视图用例靠它模拟 SSE。 */
function eventCapturingAgent(sendTicketId = "t-chat"): { agent: AgentClient; listeners: Array<(event: AgentEvent) => void> } {
  const listeners: Array<(event: AgentEvent) => void> = [];
  const agent = fakeAgent({
    onEvent: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
    sendTrigger: vi.fn(() =>
      Promise.resolve({
        triggerId: "tr-c",
        admitted: true,
        ticket: { id: sendTicketId, triggerId: "tr-c", thread: { kind: "commandId" as const, key: "tr-c" } },
        report: null,
      } satisfies EmitOutcome),
    ),
  });
  return { agent, listeners };
}

/** Ctrl+K 唤出面板:绕开单击的判定延迟,多数用例从这里进。 */
function openPanelByHotkey() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
}

it("小贝把有出处的回复存成笔记，重新打开后可带着笔记发起练习", async () => {
  const user = userEvent.setup();
  const sendBotChat = vi.fn<NonNullable<AgentClient["sendBotChat"]>>(async (_input, onEvent) => {
    onEvent({ type: "step", text: "查了历史对局" });
    onEvent({
      type: "done", text: "先问清客户哪天会用钱。",
      steps: ["查了历史对局"],
      evidence: [{ id: "game:one:2", title: "旧局 · 第 2 轮", excerpt: "客户：下个月要用。" }],
    });
  });
  const agent = fakeAgent({ sendBotChat });
  const first = render(<DeskPet agent={agent} />);
  openPanelByHotkey();
  await user.type(screen.getByRole("textbox", { name: "对话输入" }), "帮我找以前对局的证据{Enter}");
  await user.click(await screen.findByText("查到的资料（1）"));
  expect(screen.getByText("客户：下个月要用。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "存为练习笔记" }));
  expect(screen.getByText("已保存到练习笔记。")).toBeVisible();
  first.unmount();
  render(<DeskPet agent={agent} />);
  openPanelByHotkey();
  await user.click(screen.getByText("练习笔记（1）"));
  await user.click(screen.getByRole("button", { name: "用这条练" }));
  expect(sendBotChat.mock.lastCall?.[0]).toMatchObject({
    text: expect.stringContaining("先问清客户哪天会用钱"),
    notes: [{ text: "先问清客户哪天会用钱。", evidence: [{ id: "game:one:2" }] }],
  });
  expect(agent.sendTrigger).not.toHaveBeenCalled();
});

/** 渲染桌宠并拿到命令接口(App 的驱动缝,工单 15)。 */
function renderWithHandle(props: Parameters<typeof DeskPet>[0] = {}) {
  let handle: DeskPetHandle | null = null;
  const view = render(
    <DeskPet {...props} ref={(instance) => { handle = instance; }} />,
  );
  return { view, handle: () => handle };
}

describe("桌宠外壳(工单 15:只留头像和角标)", () => {
  it("默认渲染女版桌宠;头像下没有常驻按钮", () => {
    render(<DeskPet agent={fakeAgent()} />);
    expect(screen.getByRole("img", { name: /女版/ })).toHaveAttribute("src", expect.stringContaining("f-wave"));
    for (const label of [/切换男版/, "待办", "工单", "勿扰"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("⋯ 菜单里切换男版并记住选择", async () => {
    const user = userEvent.setup();
    render(<DeskPet agent={fakeAgent()} />);
    openPanelByHotkey();
    await user.click(screen.getByRole("button", { name: "更多设置" }));
    await user.click(screen.getByRole("menuitem", { name: "切换男版" }));
    expect(screen.getByRole("img", { name: /男版/ })).toHaveAttribute("src", expect.stringContaining("m-wave"));
    expect(window.localStorage.getItem("desk-pet-variant")).toBe("m");
  });

  it("右键头像也能打开 ⋯ 菜单(工单 15)", async () => {
    const user = userEvent.setup();
    render(<DeskPet agent={fakeAgent()} />);
    fireEvent.contextMenu(screen.getByRole("img", { name: /女版/ }));
    const menu = await screen.findByRole("menu", { name: "桌宠设置" });
    expect(menu).toHaveTextContent("勿扰");
    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "勿扰" }));
    expect(screen.getByRole("button", { name: "桌宠勿扰中,点击恢复" })).toBeInTheDocument();
  });

  it("勿扰收起为小圆钮,点击恢复;⋯ 菜单进勿扰", async () => {
    const user = userEvent.setup();
    render(<DeskPet agent={fakeAgent()} />);
    openPanelByHotkey();
    await user.click(screen.getByRole("button", { name: "更多设置" }));
    await user.click(screen.getByRole("menuitem", { name: "勿扰" }));
    expect(screen.queryByRole("img", { name: /女版/ })).not.toBeInTheDocument();
    const restore = screen.getByRole("button", { name: "桌宠勿扰中,点击恢复" });
    await user.click(restore);
    expect(screen.getByRole("img", { name: /女版/ })).toBeInTheDocument();
  });

  it("拖动后位置被记住;按下没挪过阈值不算拖动(审查 S4)", () => {
    const { unmount } = render(<DeskPet agent={fakeAgent()} />);
    const pet = screen.getByRole("complementary", { name: "桌宠" });
    expect(pet.style.left).toBe("");

    // 按下后只挪 2px:不算拖动,位置不动、不鼓腮。
    fireEvent.pointerDown(screen.getByRole("img", { name: /女版/ }), { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 302, clientY: 402 });
    expect(pet.style.left).toBe("");
    expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();

    // 挪过阈值才算拖:鼓腮、位置跟手、松手落盘。
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 340, clientY: 460 });
    expect(screen.getByRole("img", { name: /鼓腮/ })).toBeInTheDocument();
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 340, clientY: 460 });
    expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
    expect(pet.style.left).toBe("40px");
    expect(pet.style.top).toBe("60px");
    expect(window.localStorage.getItem("desk-pet-pos")).toBe(JSON.stringify({ left: 40, top: 60 }));
    unmount();
    render(<DeskPet agent={fakeAgent()} />);
    const petAgain = screen.getByRole("complementary", { name: "桌宠" });
    expect(petAgain.style.left).toBe("40px");
    expect(petAgain.style.top).toBe("60px");
  });

  it("pointercancel 也收尾:不留鼓腮(审查 S4)", () => {
    render(<DeskPet agent={fakeAgent()} />);
    fireEvent.pointerDown(screen.getByRole("img", { name: /女版/ }), { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 360, clientY: 400 });
    expect(screen.getByRole("img", { name: /鼓腮/ })).toBeInTheDocument();
    fireEvent.pointerCancel(document.body, { pointerId: 1, clientX: 360, clientY: 400 });
    expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
  });

  it("respect prefers-reduced-motion:关闭待机小动作", () => {
    const { unmount } = render(<DeskPet agent={fakeAgent()} />);
    expect(screen.getByRole("complementary", { name: "桌宠" })).not.toHaveAttribute("data-reduced-motion", "true");
    unmount();

    // jsdom 没有 matchMedia,打一个只回答 reduce 的桩,测完即还原。
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
    })) as unknown as typeof window.matchMedia;
    try {
      render(<DeskPet agent={fakeAgent()} />);
      expect(screen.getByRole("complementary", { name: "桌宠" })).toHaveAttribute("data-reduced-motion", "true");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("点击与面板开合(工单 15,审查 S3/S7/S8)", () => {
  it("单击头像延迟一拍打开面板;再单击收起(双击不会误开)", async () => {
    const { unmount } = render(<DeskPet agent={fakeAgent()} />);
    fireEvent.click(screen.getByRole("img", { name: /女版/ }), { detail: 1 });
    // 判定延迟内不开(S3):等一拍确认不是双击。
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("img", { name: /女版/ }), { detail: 1 });
    await waitFor(() => expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument());
    unmount();
  });

  it("双击是戳一下:不打开面板,不调模型(审查 S3)", async () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    const avatar = screen.getByRole("img", { name: /女版/ });
    await userEvent.dblClick(avatar);
    expect(screen.getByRole("status", { name: "桌宠气泡" })).toHaveTextContent(POKE_LINES[0].text);
    expect(screen.getByRole("img", { name: /鼓腮/ })).toBeInTheDocument();
    // 双击的那两次 click 不触发开面板。
    await waitFor(
      () => expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument(),
      { timeout: AVATAR_CLICK_DELAY_MS + 200 },
    );
    expect(agent.sendCommand).not.toHaveBeenCalled();
    expect(agent.sendTrigger).not.toHaveBeenCalled();
  });

  it("Ctrl+K 开面板,Esc 收起并把焦点还给头像(审查 S7)", () => {
    render(<DeskPet agent={fakeAgent()} />);
    openPanelByHotkey();
    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("region", { name: "对话面板" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /桌宠·女版/ })).toHaveFocus();
  });

  it("Ctrl+K 只认 Ctrl:⌘K 不抢浏览器快捷键;勿扰时忽略(审查 R3)", async () => {
    const user = userEvent.setup();
    render(<DeskPet agent={fakeAgent()} />);
    // ⌘K(meta)留给浏览器自己,桌宠不接管。
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();

    // 开着面板进勿扰(⋯ 菜单):勿扰期间 Ctrl+K 被忽略——若没忽略,这一下会把
    // 仍为开的 panelOpen 切成关,退出勿扰后面板就没了。
    openPanelByHotkey();
    await user.click(screen.getByRole("button", { name: "更多设置" }));
    await user.click(screen.getByRole("menuitem", { name: "勿扰" }));
    expect(screen.getByRole("button", { name: "桌宠勿扰中,点击恢复" })).toBeInTheDocument();
    openPanelByHotkey();

    await user.click(screen.getByRole("button", { name: "桌宠勿扰中,点击恢复" }));
    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
  });

  it("头像是可聚焦的按钮,带 aria-expanded(审查 S8)", () => {
    render(<DeskPet agent={fakeAgent()} />);
    const avatar = screen.getByRole("button", { name: /桌宠·女版·挥手笑/ });
    expect(avatar).toHaveAttribute("aria-haspopup", "dialog");
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    openPanelByHotkey();
    expect(avatar).toHaveAttribute("aria-expanded", "true");
  });

  it("闲置 3 分钟打瞌睡;事件反应把它叫醒(审查 S5),点一下也醒", async () => {
    vi.useFakeTimers();
    try {
      render(<DeskPet agent={fakeAgent()} />);
      act(() => {
        vi.advanceTimersByTime(IDLE_SLEEP_MS + 1);
      });
      expect(screen.getByRole("img", { name: /打瞌睡/ })).toBeInTheDocument();

      // 单击头像:醒来并打开面板(延迟判定走假钟)。
      fireEvent.click(screen.getByRole("img", { name: /打瞌睡/ }), { detail: 1 });
      act(() => {
        vi.advanceTimersByTime(AVATAR_CLICK_DELAY_MS + 10);
      });
      expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("气泡约 4 秒自动消失(审查 S9)", () => {
    vi.useFakeTimers();
    try {
      render(<DeskPet agent={fakeAgent()} />);
      fireEvent.click(screen.getByRole("img", { name: /女版/ }), { detail: 2 }); // 双击戳一下
      expect(screen.getByRole("status", { name: "桌宠气泡" })).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(BUBBLE_HOLD_MS + 10);
      });
      expect(screen.queryByRole("status", { name: "桌宠气泡" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("对话流式与红点(工单 12/15)", () => {
  it("回复期间显示「…」、表情切 think;delta 逐字上屏;ready 定稿并切表情,建议渲染成按钮", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = eventCapturingAgent("t-stream");
    render(<DeskPet agent={agent} />);

    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await act(async () => {});

    expect(screen.getByLabelText("正在输入")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /拿笔想/ })).toBeInTheDocument();

    act(() => {
      listeners.forEach((listener) => listener({ type: "delta", ticketId: "t-stream", text: "我在" }));
    });
    expect(screen.queryByLabelText("正在输入")).not.toBeInTheDocument();

    act(() => {
      listeners.forEach((listener) => listener({ type: "delta", ticketId: "t-stream", text: "呢。" }));
    });
    const record = screen.getByRole("log", { name: "对话记录" });
    expect(record).toHaveTextContent("我在呢。");

    act(() => {
      listeners.forEach((listener) =>
        listener({
          type: "report",
          report: { ticketId: "t-stream", status: "ready", text: "我在呢，你说。", emotion: "cheer", quickActions: ["换个客户"] },
        }),
      );
    });
    expect(record).toHaveTextContent("我在呢，你说。");
    expect(screen.getByRole("img", { name: /欢呼/ })).toBeInTheDocument();

    // 动态建议(工单 16):点了作为一句话发给桌宠(对话式),不再走命令+跳转。
    await user.click(within(record).getByRole("button", { name: "换个客户" }));
    expect(agent.sendTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "chat", data: expect.objectContaining({ text: "换个客户" }) }),
    );
    expect(agent.sendCommand).not.toHaveBeenCalled();
  });

  it("没有 delta 也能落回复:回执自带的 ready Report 直接定稿(审查 S1)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      sendTrigger: vi.fn(() =>
        Promise.resolve({
          triggerId: "tr-r",
          admitted: true,
          ticket: { id: "t-receipt", triggerId: "tr-r", thread: { kind: "commandId" as const, key: "tr-r" } },
          report: { ticketId: "t-receipt", status: "ready", text: "我在呢，你说。", emotion: "wave" },
        } satisfies EmitOutcome),
      ),
    });
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("我在呢，你说。"),
    );
    expect(screen.queryByLabelText("正在输入")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
  });

  it("failed/dropped 也是终态:不再挂「…」;回退路径后面的 ready 覆盖同一条(审查 S2)", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = eventCapturingAgent("t-fail");
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await act(async () => {});

    act(() => {
      listeners.forEach((listener) => listener({ type: "delta", ticketId: "t-fail", text: "我在" }));
    });
    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "report", report: { ticketId: "t-fail", status: "failed", text: "真实模型没接上，再说一遍？" } }),
      );
    });
    expect(screen.queryByLabelText("正在输入")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();

    // 回退路径:demo 全文重流再 ready——只有一条消息,文本是最终稿。
    act(() => {
      listeners.forEach((listener) => listener({ type: "delta", ticketId: "t-fail", text: "我在呢" }));
      listeners.forEach((listener) =>
        listener({ type: "report", report: { ticketId: "t-fail", status: "ready", text: "我在呢，你说。", emotion: "cheer" } }),
      );
    });
    const record = screen.getByRole("log", { name: "对话记录" });
    expect(record).toHaveTextContent("我在呢，你说。");
    expect(record.textContent?.match(/我在呢，你说。/g)).toHaveLength(1);
    expect(screen.getByRole("img", { name: /欢呼/ })).toBeInTheDocument();
  });

  it("两条并发:第一条回来不打断第二条的「…」(审查 S10)", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = eventCapturingAgent("t-first");
    // 回执挂起:工单号靠 delta 登记,两条都保持「已发未终态」。
    (agent.sendTrigger as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise<EmitOutcome>(() => undefined));
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把上周投研总结成一句话{Enter}");
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "顺便看看上局复盘{Enter}");
    expect(screen.getByLabelText("正在输入")).toBeInTheDocument();

    // 第一条的 delta+终态先到:第二条还在等,「…」仍挂着。
    act(() => {
      listeners.forEach((listener) => listener({ type: "delta", ticketId: "t-first", text: "总结好了" }));
      listeners.forEach((listener) =>
        listener({ type: "report", report: { ticketId: "t-first", status: "ready", text: "总结好了。" } }),
      );
    });
    expect(screen.getByLabelText("正在输入")).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("总结好了。");
  });

  it("发送失败给一句兜底回复,不挂「…」", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({ sendTrigger: vi.fn(() => Promise.reject(new Error("网络不可用"))) });
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("网络不顺"),
    );
    expect(screen.queryByLabelText("正在输入")).not.toBeInTheDocument();
  });

  it("面板关着收到回复:头像亮红点;重新打开红点消失、历史还在", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = eventCapturingAgent("t-away");
    render(<DeskPet agent={agent} />);

    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await act(async () => {});
    fireEvent.keyDown(screen.getByRole("region", { name: "对话面板" }), { key: "Escape" });

    act(() => {
      listeners.forEach((listener) => listener({ type: "delta", ticketId: "t-away", text: "我在呢" }));
      listeners.forEach((listener) =>
        listener({ type: "report", report: { ticketId: "t-away", status: "ready", text: "我在呢，你说。", emotion: "wave" } }),
      );
      listeners.forEach((listener) =>
        listener({ type: "channel", channel: { target: "pet-bubble", ticketId: "t-away", text: "我在呢，你说。" } }),
      );
    });

    expect(screen.getByLabelText("有新回复")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "桌宠气泡" })).toHaveTextContent("我在呢，你说。");

    openPanelByHotkey();
    expect(screen.queryByLabelText("有新回复")).not.toBeInTheDocument();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("我在呢，你说。");
  });

  it("面板开着时收到 pet-bubble 不弹气泡", () => {
    const { agent, listeners } = eventCapturingAgent();
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "channel", channel: { target: "pet-bubble", ticketId: "t1", text: "很".repeat(50) } }),
      );
    });
    expect(screen.queryByRole("status", { name: "桌宠气泡" })).not.toBeInTheDocument();
  });

  it("超 40 字的气泡截到 40 字(spec 硬上限)", () => {
    const { agent, listeners } = eventCapturingAgent();
    render(<DeskPet agent={agent} />);
    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "channel", channel: { target: "pet-bubble", ticketId: "t1", text: "很".repeat(50) } }),
      );
    });
    expect(screen.getByRole("status", { name: "桌宠气泡" }).textContent).toBe("很".repeat(40));
  });

  it("历史本地存最近 50 条;「清空」一键抹掉", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "desk-pet-chat",
      JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ speaker: "pet" as const, text: `旧话${index}` }))),
    );
    const { agent, listeners } = eventCapturingAgent("t-hist");
    render(<DeskPet agent={agent} />);

    openPanelByHotkey();
    const record = screen.getByRole("log", { name: "对话记录" });
    expect(record).toHaveTextContent("旧话0");

    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await act(async () => {});
    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "report", report: { ticketId: "t-hist", status: "ready", text: "新话", emotion: "wave" } }),
      );
    });
    await act(async () => {});

    expect(record).toHaveTextContent("新话");
    expect(record).not.toHaveTextContent("旧话0");
    expect(record).toHaveTextContent("旧话49");
    const stored = JSON.parse(window.localStorage.getItem("desk-pet-chat")!) as Array<{ text: string }>;
    expect(stored).toHaveLength(50);
    expect(stored[0].text).toBe("旧话2");

    await user.click(screen.getByRole("button", { name: "清空对话" }));
    expect(screen.queryByText("旧话49")).not.toBeInTheDocument();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent(/随时叫我/);
  });

  it("上一条还没回,仍能继续发下一条(全双工)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({ sendTrigger: vi.fn(() => new Promise<EmitOutcome>(() => undefined)) });
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把上周投研总结成一句话{Enter}");
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "顺便看看上局复盘{Enter}");
    expect(agent.sendTrigger).toHaveBeenCalledTimes(2);
  });

  it("对话输入「演示」唤出演示,不进对话链路(工单 10→15:分流在会话层)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    const onOpenDemo = vi.fn();
    render(<DeskPet agent={agent} onOpenDemo={onOpenDemo} />);
    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "演示{Enter}");
    expect(onOpenDemo).toHaveBeenCalledTimes(1);
    expect(agent.sendTrigger).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "chat" }));
  });

  it("通话中可跟桌宠打字:消息只走 pet 源对话触发,不进经理上下文(工单 15)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} inCall />);
    openPanelByHotkey();
    const input = screen.getByRole("textbox", { name: "对话输入" });
    expect(input).toBeEnabled();
    await user.type(input, "经理刚才那句什么意思{Enter}");
    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "pet",
      kind: "chat",
      data: expect.objectContaining({ text: "经理刚才那句什么意思" }),
    });
  });
});

describe("角标与待拍板卡(工单 15)", () => {
  /** 工单视图样例工厂。 */
  function tv(ticketId: string, status: AgentTicketView["status"], text: string, extra: Partial<AgentTicketView> = {}): AgentTicketView {
    return { ticketId, status, text, ...extra };
  }

  it("waiting+blocked 数显在角标;点角标开面板,待拍板卡插在对话流里", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      tickets: vi.fn(() =>
        Promise.resolve([
          tv("t-1", "waiting", "本周投研先押 AI 还是消费？等你拍板。"),
          tv("t-2", "blocked", "缺素材,卡住了。"),
          tv("t-3", "ready", "办完了"),
        ]),
      ),
    });
    render(<DeskPet agent={agent} />);

    await user.click(await screen.findByRole("button", { name: "待办 2" }));
    const panel = await screen.findByRole("region", { name: "对话面板" });
    expect(panel).toHaveTextContent("本周投研先押 AI 还是消费？等你拍板。");
    // blocked 只读卡:显示受阻原因,没有按钮。
    expect(screen.getByRole("article", { name: "受阻：缺素材,卡住了。" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "同意" })).toBeInTheDocument();
  });

  it("待拍板卡「同意」「驳回」把决定发回 Router", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      tickets: vi.fn(() => Promise.resolve([tv("t-w", "waiting", "等你拍板")])),
    });
    render(<DeskPet agent={agent} />);
    await user.click(await screen.findByRole("button", { name: "待办 1" }));
    await user.click(screen.getByRole("button", { name: "同意" }));
    expect(agent.sendCommand).toHaveBeenCalledWith("同意 t-w");
    await user.click(screen.getByRole("button", { name: "驳回" }));
    expect(agent.sendCommand).toHaveBeenCalledWith("驳回 t-w");
  });

  it("「改一改」进引用态:接着发的一句话就是该工单的批注(工单 15)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      tickets: vi.fn(() => Promise.resolve([tv("t-w", "waiting", "草稿好了，进待审，等你过目。")])),
    });
    render(<DeskPet agent={agent} />);
    await user.click(await screen.findByRole("button", { name: "待办 1" }));

    await user.click(screen.getByRole("button", { name: "改一改" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    expect(input).toHaveAttribute("placeholder", "说一句,这条工单就按它改");
    await user.type(input, "开头一句改得口语一点{Enter}");

    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "pet",
      kind: "annotate",
      data: { ticketId: "t-w", note: "开头一句改得口语一点" },
    });
    // 批注只发 annotate,不再当对话发给模型。
    expect(agent.sendTrigger).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "chat" }));
    // 发完引用态自动退场。
    expect(input).toHaveAttribute("placeholder", "跟桌宠说点什么…(Enter 发送)");
  });

  it("report 事件实时刷新:新工单落 waiting,角标从无到有并晃一下;ready 后卡从面板退场", async () => {
    const { agent, listeners } = eventCapturingAgent();
    render(<DeskPet agent={agent} />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /^待办 \d+$/ })).not.toBeInTheDocument();

    act(() => {
      listeners.forEach((listener) => listener({ type: "report", report: { ticketId: "t-w", status: "waiting", text: "等你拍板" } }));
    });
    expect(screen.getByRole("button", { name: "待办 1" })).toBeInTheDocument();

    openPanelByHotkey();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("等你拍板");
    act(() => {
      listeners.forEach((listener) => listener({ type: "report", report: { ticketId: "t-w", status: "ready", text: "拍板后办妥" } }));
    });
    expect(screen.getByRole("log", { name: "对话记录" })).not.toHaveTextContent("等你拍板");
  });
});

describe("放权、状态条与工作日志(工单 15)", () => {
  it("状态条:在听 → 在想(等回复) → 在跑 N 件事(progress 工单数)", async () => {
    const { agent, listeners } = eventCapturingAgent("t-think");
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    expect(screen.getByText("在听")).toBeInTheDocument();

    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "report", report: { ticketId: "t-run", status: "progress", text: "两条线并行开工" } }),
      );
    });
    expect(screen.getByText("在跑 1 件事")).toBeInTheDocument();
  });

  it("两档开关:「只听我的」⇄「主动办」各调 setAcceptMode(off/auto);面板打开时拉取放权", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({ policy: vi.fn(() => Promise.resolve(emptyPolicy("off"))) });
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    await waitFor(() => expect(screen.getByRole("button", { name: "只听我的" })).toHaveAttribute("aria-pressed", "true"));

    await user.click(screen.getByRole("button", { name: "主动办" }));
    expect(agent.setAcceptMode).toHaveBeenCalledWith("auto");
    await user.click(screen.getByRole("button", { name: "只听我的" }));
    expect(agent.setAcceptMode).toHaveBeenCalledWith("off");
  });

  it("观察档只在 ⋯ 菜单:点了调 setAcceptMode(observe)(演示第⑦幕用)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    // 状态条只有两档,没有「观察」。
    const modes = screen.getByRole("group", { name: "放权" });
    expect(within(modes).queryByText("观察")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "更多设置" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /观察模式/ }));
    expect(agent.setAcceptMode).toHaveBeenCalledWith("observe");
  });

  it("点状态条展开工作日志:工单与评估记录按时间线合并显示", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      tickets: vi.fn((): Promise<AgentTicketView[]> =>
        Promise.resolve([{ ticketId: "t-1", status: "ready", text: "办完了", worker: "复盘", at: "2026-11-05T10:00:00.000Z" }]),
      ),
      evals: vi.fn((): Promise<AgentEvalRecord[]> =>
        Promise.resolve([
          {
            at: "2026-11-05T10:05:00.000Z",
            triggerId: "tr-1",
            ruleId: "R1",
            wouldDo: "自动起草本局复盘一句话",
            why: "对局刚结束，趁热提炼经理哪招值得学",
            outcome: "executed" as const,
          },
        ]),
      ),
    });
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    await user.click(screen.getByRole("button", { name: /工作日志/ }));

    const log = await screen.findByRole("log", { name: "工作日志" });
    expect(log).toHaveTextContent("复盘");
    expect(log).toHaveTextContent("办完了");
    expect(log).toHaveTextContent("R1");
    expect(log).toHaveTextContent("自动起草本局复盘一句话");
    expect(log).toHaveTextContent("已执行");
    await user.click(screen.getByRole("button", { name: /收起日志/ }));
    expect(screen.queryByRole("log", { name: "工作日志" })).not.toBeInTheDocument();
  });
});

describe("Agent 轨迹行与工单定位(工单 15)", () => {
  /**
   * 带完整账本视图的对话 agent:SSE 报告先落乐观视图(只有状态与文案),
   * 拉回的账本折叠视图补 Worker 名与触发号,轨迹行据此归并评估记录。
   */
  function traceAgent(): { agent: AgentClient; listeners: Array<(event: AgentEvent) => void> } {
    const listeners: Array<(event: AgentEvent) => void> = [];
    const agent = fakeAgent({
      onEvent: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
      sendTrigger: vi.fn(() =>
        Promise.resolve({
          triggerId: "tr-c",
          admitted: true,
          ticket: { id: "t-tr", triggerId: "tr-c", thread: { kind: "commandId" as const, key: "tr-c" } },
          report: null,
        } satisfies EmitOutcome),
      ),
      tickets: vi.fn((): Promise<AgentTicketView[]> =>
        Promise.resolve([
          { ticketId: "t-tr", status: "ready", text: "我在呢，你说。", triggerId: "tr-c", worker: "对话", at: "2026-11-05T10:00:00.000Z" },
        ]),
      ),
      evals: vi.fn((): Promise<AgentEvalRecord[]> =>
        Promise.resolve([
          {
            at: "2026-11-05T10:00:01.000Z",
            triggerId: "tr-c",
            ruleId: "R1",
            wouldDo: "接住话头先回应",
            why: "客户先开口",
            outcome: "executed" as const,
          },
        ]),
      ),
    });
    return { agent, listeners };
  }

  /** 发一句对话并等 SSE ready 到达(轨迹行数据随账本视图刷新补齐)。 */
  async function sendAndSettle(listeners: Array<(event: AgentEvent) => void>) {
    const user = userEvent.setup();
    openPanelByHotkey();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await act(async () => {});
    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "report", report: { ticketId: "t-tr", status: "ready", text: "我在呢，你说。" } }),
      );
    });
  }

  it("回复上方出现「做了什么」轨迹行:Worker 名与评估按同一触发归并,展开见明细", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = traceAgent();
    render(<DeskPet agent={agent} />);
    await sendAndSettle(listeners);

    const toggle = await screen.findByRole("button", { name: /做了什么/ });
    expect(toggle).toHaveTextContent("🔍 查了对话");
    expect(toggle).toHaveTextContent("📋 接住话头先回应");
    expect(toggle).toHaveTextContent("✅ 办完了");

    await user.click(toggle);
    expect(screen.getByText(/R1 · 客户先开口 · 已执行/)).toBeInTheDocument();
  });

  it("回复里的工单可点开:「看工单」展开工作日志并高亮该工单那行", async () => {
    const { agent, listeners } = traceAgent();
    render(<DeskPet agent={agent} />);
    await sendAndSettle(listeners);
    await screen.findByRole("button", { name: /做了什么/ });

    await userEvent.click(screen.getByRole("button", { name: "看工单" }));
    const log = await screen.findByRole("log", { name: "工作日志" });
    const row = within(log).getByRole("article");
    expect(row).toHaveAttribute("data-highlight", "true");
    expect(row).toHaveTextContent("对话·我在呢，你说。");
  });
});

describe("拖给它:素材入草稿(工单 07)", () => {
  it("文件拖到桌宠上高亮「交给我」,拖走即消失", () => {
    render(<DeskPet agent={fakeAgent()} />);
    const pet = screen.getByRole("complementary", { name: "桌宠" });

    expect(screen.queryByText("交给我")).not.toBeInTheDocument();
    fireEvent.dragOver(pet, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("交给我")).toBeInTheDocument();
    expect(pet).toHaveAttribute("data-drop-hover", "true");

    fireEvent.dragLeave(pet);
    expect(screen.queryByText("交给我")).not.toBeInTheDocument();
    expect(pet).not.toHaveAttribute("data-drop-hover");
  });

  it("松手发送 dropped 触发:只传文件名与类型,不上传文件内容(demo)", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    const pet = screen.getByRole("complementary", { name: "桌宠" });
    const audio = new File(["(音频内容,不应被读走)"], "王姐通话.mp3", { type: "audio/mpeg" });

    fireEvent.dragOver(pet, { dataTransfer: { files: [audio] } });
    fireEvent.drop(pet, { dataTransfer: { files: [audio] } });

    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "materials",
      kind: "dropped",
      data: { fileName: "王姐通话.mp3", fileKind: "audio" },
    });
    expect(screen.queryByText("交给我")).not.toBeInTheDocument();
  });

  it("画像 JSON 与角色卡按文件名区分 persona / role", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    const pet = screen.getByRole("complementary", { name: "桌宠" });
    const cases: Array<[string, "persona" | "role"]> = [
      ["李姐画像.json", "persona"],
      ["老陈角色卡.json", "role"],
    ];

    for (const [name, fileKind] of cases) {
      fireEvent.drop(pet, { dataTransfer: { files: [new File(["{}"], name, { type: "application/json" })] } });
      expect(agent.sendTrigger).toHaveBeenLastCalledWith({
        source: "materials",
        kind: "dropped",
        data: { fileName: name, fileKind },
      });
    }
  });

  it("拖入的文件同时作为附件消息进对话流:一个文件一条(工单 15)", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    openPanelByHotkey();
    const pet = screen.getByRole("complementary", { name: "桌宠" });
    const files = [
      new File(["(音频)"], "王姐通话.mp3", { type: "audio/mpeg" }),
      new File(["{}"], "李姐画像.json", { type: "application/json" }),
    ];

    fireEvent.drop(pet, { dataTransfer: { files } });

    const list = within(screen.getByRole("log", { name: "对话记录" }));
    expect(list.getByText("📎 王姐通话.mp3")).toBeInTheDocument();
    expect(list.getByText("📎 李姐画像.json")).toBeInTheDocument();
    // 触发照发(素材入草稿链路不变)。
    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "materials",
      kind: "dropped",
      data: { fileName: "王姐通话.mp3", fileKind: "audio" },
    });
  });
});

describe("命令接口:App 驱动桌宠(工单 15)", () => {
  it("openPanel/closePanel 控制面板;locate:log 展开工作日志,todo 滚到待拍板卡", async () => {
    const agent = fakeAgent({
      tickets: vi.fn(() =>
        Promise.resolve([{ ticketId: "t-w", status: "waiting" as const, text: "等你拍板" }]),
      ),
    });
    const { handle } = renderWithHandle({ agent });
    act(() => {
      handle()!.openPanel({ locate: "log" });
    });
    expect(await screen.findByRole("log", { name: "工作日志" })).toBeInTheDocument();
    act(() => {
      handle()!.closePanel();
    });
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();

    act(() => {
      handle()!.openPanel({ locate: "todo" });
    });
    expect(await screen.findByRole("article", { name: /待拍板/ })).toBeInTheDocument();
  });

  it("sendAsUser 如同玩家亲手输入,但不打开面板(审查 B1:演示不写开合)", async () => {
    const agent = fakeAgent();
    const { handle } = renderWithHandle({ agent });
    act(() => {
      handle()!.sendAsUser("小贝，跟观众打个招呼");
    });
    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "pet",
      kind: "chat",
      data: expect.objectContaining({ text: "小贝，跟观众打个招呼" }),
    });
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();
  });

  it("react 换表情:翻牌 cheer、举牌 think、挂断 wave(短时)", () => {
    vi.useFakeTimers();
    try {
      const { handle } = renderWithHandle({ agent: fakeAgent() });
      act(() => {
        handle()!.react({ kind: "hidden-revealed" });
      });
      expect(screen.getByRole("img", { name: /欢呼/ })).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("牌局事件的 Report 表情(工单 16):非对话工单带 emotion → 桌宠短时微反应,停留后还原", () => {
    vi.useFakeTimers();
    try {
      // 经理出卡 → Worker 落 dropped + think 的 Report(见 server/agent/reactions.test)。
      const { agent, listeners } = eventCapturingAgent();
      render(<DeskPet agent={agent} />);
      act(() => {
        listeners.forEach((listener) =>
          listener({ type: "report", report: { ticketId: "t-react", status: "dropped", text: "看在眼里,不说话。", emotion: "think" } }),
        );
      });
      expect(screen.getByRole("img", { name: /拿笔想/ })).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshPolicy 重拉放权:演示切过放权后开关立即同步", async () => {
    let mode: AgentPolicy["acceptMode"] = "observe";
    const agent = fakeAgent({ policy: vi.fn(() => Promise.resolve(emptyPolicy(mode))) });
    const { handle } = renderWithHandle({ agent });
    act(() => {
      handle()!.openPanel();
    });
    await screen.findByRole("group", { name: "放权" });
    expect(screen.getByRole("button", { name: "只听我的" })).toHaveAttribute("aria-pressed", "false");

    mode = "auto";
    act(() => {
      handle()!.refreshPolicy();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "主动办" })).toHaveAttribute("aria-pressed", "true"));
    expect(agent.policy).toHaveBeenCalledTimes(2);
  });

  it("演示表情优先级最高:盖过对话回复自带的表情标签(审查 B1)", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = eventCapturingAgent("t-demo");
    const { view, handle } = renderWithHandle({ agent, demoExpression: "pout" });
    act(() => {
      handle()!.openPanel();
    });

    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await act(async () => {});
    act(() => {
      listeners.forEach((listener) =>
        listener({
          type: "report",
          report: { ticketId: "t-demo", status: "ready", text: "我在呢，你说。", emotion: "cheer" },
        }),
      );
    });
    // 回复带了 cheer 标签,但演示接管的 pout 优先(审查 B1:第②幕表情不再被盖)。
    expect(screen.getByRole("img", { name: /鼓腮/ })).toBeInTheDocument();

    // 演示把表情还回去后,才轮到对话情绪。
    view.rerender(<DeskPet agent={agent} demoExpression={null} ref={(instance) => undefined} />);
    expect(screen.getByRole("img", { name: /欢呼/ })).toBeInTheDocument();
  });
});

describe("桌宠局内私聊", () => {
  it("展示本轮依据、脚本追问和产品卡，并在重生成时收起旧内容", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    const coachCall: Pick<Conversation, "id" | "turns" | "productFacts"> = {
      id: "call-a",
      turns: [{ number: 2, speaker: "manager", text: "20万档有150元立减金。" }],
      productFacts: SEED_PRODUCT_CARD,
    };
    const { rerender } = render(<DeskPet agent={agent} inCall coachCall={coachCall} />);
    expect(screen.getByRole("status")).toHaveTextContent("活动权益");
    await user.click(screen.getByRole("button", { name: "桌宠有一条提示" }));
    expect(screen.getByRole("region", { name: "桌宠私聊" })).toHaveTextContent("20万档有150元立减金。");
    await user.click(screen.getByRole("button", { name: "核对本局产品卡" }));
    expect(screen.getByRole("log")).toHaveTextContent("20万档为微信立减金150元");
    await user.type(screen.getByRole("textbox", { name: "问桌宠" }), "怎么婉拒？{Enter}");
    expect(screen.getByRole("log")).toHaveTextContent("今天不提供资金情况");
    expect(agent.sendCommand).not.toHaveBeenCalled();
    expect(agent.sendTrigger).not.toHaveBeenCalled();

    rerender(
      <DeskPet
        agent={agent}
        inCall
        coachCall={{
          ...coachCall,
          turns: [{ number: 2, speaker: "manager", text: "方便聊两句吗？" }],
        }}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "桌宠私聊" }));
    expect(screen.getByRole("region", { name: "桌宠私聊" })).toHaveTextContent("方便聊两句吗？");
    expect(screen.getByRole("log")).toBeEmptyDOMElement();
  });
});
