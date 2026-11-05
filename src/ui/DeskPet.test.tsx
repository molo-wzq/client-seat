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
import { DeskPet, type PetExpression } from "./DeskPet";
import { IDLE_SLEEP_MS, POKE_LINES } from "./pet-reactions";
import type { AgentClient } from "./agent-client";

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

/** 捕获事件监听器的假 agent:流式与红点用例靠它模拟 SSE。 */
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
      }),
    ),
  });
  return { agent, listeners };
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

describe("点击优先对话:对话面板(工单 12)", () => {
  it("单击头像打开对话面板,输入框自动聚焦;快捷环收进顶部变成芯片,点了才执行", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    const onQuickAction = vi.fn();
    render(<DeskPet agent={agent} onQuickAction={onQuickAction} />);

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));

    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveFocus();
    for (const label of ["换个客户", "再来一局", "上局复盘", "本周投研"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "换个客户" }));
    expect(agent.sendCommand).toHaveBeenCalledWith("换个客户");
    expect(onQuickAction).toHaveBeenCalledWith("换个客户");
    // 点完芯片收起面板,回到牌桌。
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();
  });

  it("Ctrl+K 打开同一个面板;Enter 发送对话触发,面板不收起", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("textbox", { name: "对话输入" });

    await user.type(input, "经理刚才那句什么意思{Enter}");

    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "pet",
      kind: "chat",
      data: expect.objectContaining({ text: "经理刚才那句什么意思" }),
    });
    // 对话保留:发送后面板仍然打开。
    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
  });

  it("Esc 关闭面板且不发送;再点头像又能打开", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "对话输入" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();
    expect(agent.sendTrigger).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
  });

  it("收到 pet-bubble 事件显示气泡,超 40 字截断;面板开着时不再弹气泡", () => {
    const { agent, listeners } = eventCapturingAgent();
    render(<DeskPet agent={agent} />);

    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "channel", channel: { target: "pet-bubble", ticketId: "t1", text: "很".repeat(50) } }),
      );
    });
    const bubble = screen.getByRole("status", { name: "桌宠气泡" });
    expect(bubble.textContent).toBe("很".repeat(40));

    // 面板开着:回复就在面板里看,气泡不更新(工单 12)。
    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
    act(() => {
      listeners.forEach((listener) =>
        listener({ type: "channel", channel: { target: "pet-bubble", ticketId: "t1", text: "这条不开面板不弹" } }),
      );
    });
    expect(screen.getByRole("status", { name: "桌宠气泡" }).textContent).toBe("很".repeat(40));
  });

  it("通话中输入框锁住,提示「通话中，挂断后再聊」,提交也不发送;表情反应照常", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} inCall reaction={{ kind: "hidden-revealed" }} />);

    fireEvent.click(screen.getByRole("img", { name: /欢呼/ }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "通话中，挂断后再聊");

    fireEvent.submit(input.closest("form")!);
    expect(agent.sendTrigger).not.toHaveBeenCalled();
    // 锁的是输入,表情反应不受影响(工单 12)。
    expect(screen.getByRole("img", { name: /欢呼/ })).toBeInTheDocument();
  });

  it("按住说话只留占位:按钮存在且禁用,不接 ASR", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
    const holdSpeak = screen.getByRole("button", { name: /按住说话/ });
    expect(holdSpeak).toBeDisabled();
    expect(agent.sendCommand).not.toHaveBeenCalled();
  });

  it("上一条还没回,仍能继续发下一条(全双工)", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({ sendTrigger: vi.fn(() => new Promise<EmitOutcome>(() => undefined)) });
    render(<DeskPet agent={agent} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把上周投研总结成一句话{Enter}");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "顺便看看上局复盘{Enter}");

    expect(agent.sendTrigger).toHaveBeenCalledTimes(2);
    expect(agent.sendTrigger).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "chat", data: expect.objectContaining({ text: "把上周投研总结成一句话" }) }),
    );
    expect(agent.sendTrigger).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "chat", data: expect.objectContaining({ text: "顺便看看上局复盘" }) }),
    );
  });

  it("对话输入「演示」唤出演示,不进对话链路,面板收起", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    const onOpenDemo = vi.fn();
    render(<DeskPet agent={agent} onOpenDemo={onOpenDemo} />);

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "演示{Enter}");
    expect(onOpenDemo).toHaveBeenCalledTimes(1);
    expect(agent.sendTrigger).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();
  });
});

describe("对话流式与红点(工单 12)", () => {
  it("回复期间显示「…」、表情切 think;delta 到达逐字显示;结束后按表情标签切表情、建议渲染成按钮", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = eventCapturingAgent("t-stream");
    render(<DeskPet agent={agent} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
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

    // 建议只是建议:点了才执行(发命令 + 跳转)。
    await user.click(within(record).getByRole("button", { name: "换个客户" }));
    expect(agent.sendCommand).toHaveBeenCalledWith("换个客户");
  });

  it("面板关闭时收到新回复:头像亮红点、气泡弹出;重新打开红点消失、历史还在", async () => {
    const user = userEvent.setup();
    const { agent, listeners } = eventCapturingAgent("t-away");
    render(<DeskPet agent={agent} />);

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "在吗{Enter}");
    await act(async () => {});
    fireEvent.keyDown(screen.getByRole("textbox", { name: "对话输入" }), { key: "Escape" });
    expect(screen.queryByLabelText("有新回复")).not.toBeInTheDocument();

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

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
    expect(screen.queryByLabelText("有新回复")).not.toBeInTheDocument();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("我在呢，你说。");
  });

  it("历史本地存最近 50 条:超出的旧话被截掉;「清空」一键抹掉", async () => {
    const user = userEvent.setup();
    const seed = Array.from({ length: 50 }, (_, index) => ({ speaker: "pet" as const, text: `旧话${index}` }));
    window.localStorage.setItem("desk-pet-chat", JSON.stringify(seed));
    const { agent, listeners } = eventCapturingAgent("t-hist");
    render(<DeskPet agent={agent} />);

    fireEvent.click(screen.getByRole("img", { name: /女版/ }));
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
    // 最旧的两句(旧话0/旧话1)被截掉,顶上新进了「在吗」与「新话」。
    expect(stored[0]!.text).toBe("旧话2");
    expect(within(record).queryByText("旧话1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空对话" }));
    expect(screen.queryByText("旧话49")).not.toBeInTheDocument();
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent(/随时叫我/);
  });
});

describe("互动感(工单 12)", () => {
  it("双击头像戳一下:固定台词轮换、切换表情,不调模型", () => {
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);
    const avatar = screen.getByRole("img", { name: /女版/ });

    fireEvent.doubleClick(avatar);
    expect(screen.getByRole("status", { name: "桌宠气泡" })).toHaveTextContent(POKE_LINES[0].text);
    expect(screen.getByRole("img", { name: /鼓腮/ })).toBeInTheDocument();

    fireEvent.doubleClick(avatar);
    expect(screen.getByRole("status", { name: "桌宠气泡" })).toHaveTextContent(POKE_LINES[1].text);
    expect(screen.getByRole("img", { name: /欢呼/ })).toBeInTheDocument();

    expect(agent.sendCommand).not.toHaveBeenCalled();
    expect(agent.sendTrigger).not.toHaveBeenCalled();
  });

  it("拖动中被拎起:表情变 pout,松手恢复", () => {
    render(<DeskPet agent={fakeAgent()} />);
    fireEvent.pointerDown(screen.getByRole("img", { name: /女版/ }), { pointerId: 1, clientX: 300, clientY: 400 });
    expect(screen.getByRole("img", { name: /鼓腮/ })).toBeInTheDocument();
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 340, clientY: 460 });
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 340, clientY: 460 });
    expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
  });

  it("闲置超过 3 分钟变 sleepy,再点一下醒来:只是表情,不推送消息", () => {
    vi.useFakeTimers();
    try {
      render(<DeskPet agent={fakeAgent()} />);
      act(() => {
        vi.advanceTimersByTime(IDLE_SLEEP_MS + 1);
      });
      expect(screen.getByRole("img", { name: /打瞌睡/ })).toBeInTheDocument();

      // 醒来不弹气泡、不提示用户,只回到正常神态(单击照旧打开对话面板)。
      fireEvent.click(screen.getByRole("img", { name: /打瞌睡/ }));
      expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "桌宠气泡" })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("事件→表情:翻开隐藏牌→cheer,举牌→think,挂断→wave", () => {
    const { rerender } = render(<DeskPet agent={fakeAgent()} reaction={{ kind: "hidden-revealed" }} />);
    expect(screen.getByRole("img", { name: /欢呼/ })).toBeInTheDocument();

    rerender(<DeskPet agent={fakeAgent()} reaction={{ kind: "hidden-raised" }} />);
    expect(screen.getByRole("img", { name: /拿笔想/ })).toBeInTheDocument();

    rerender(<DeskPet agent={fakeAgent()} reaction={{ kind: "call-ended" }} />);
    expect(screen.getByRole("img", { name: /挥手笑/ })).toBeInTheDocument();
  });
});

describe("角标、待办面板与工单列表(工单 05)", () => {
  /** 工单视图样例工厂。 */
  function tv(ticketId: string, status: AgentTicketView["status"], text: string): AgentTicketView {
    return { ticketId, status, text };
  }

  it("初始拉取工单视图:waiting 数显在头顶角标", async () => {
    const busy = fakeAgent({
      tickets: vi.fn(() =>
        Promise.resolve([tv("t-1", "waiting", "本周投研先押 AI 还是消费？等你拍板。"), tv("t-2", "ready", "办完了")]),
      ),
    });
    render(<DeskPet agent={busy} />);
    const badge = await screen.findByRole("button", { name: "待办 1" });
    expect(badge).toHaveTextContent("1");
    expect(busy.tickets).toHaveBeenCalledTimes(1);
  });

  it("没有 waiting 工单时不出角标", async () => {
    const idle = fakeAgent({ tickets: vi.fn(() => Promise.resolve([tv("t-3", "ready", "收到，马上办")])) });
    render(<DeskPet agent={idle} />);
    // 等初始拉取的微任务跑完再断言,避免假阴性。
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /^待办 \d+$/ })).not.toBeInTheDocument();
  });

  it("report 事件实时刷新:新工单落 waiting,角标从无到有", async () => {
    const { agent, listeners } = eventCapturingAgent();
    render(<DeskPet agent={agent} />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /^待办 \d+$/ })).not.toBeInTheDocument();

    act(() => {
      listeners.forEach((listener) => listener({ type: "report", report: { ticketId: "t-w", status: "waiting", text: "等你拍板" } }));
    });

    expect(screen.getByRole("button", { name: "待办 1" })).toBeInTheDocument();
  });

  it("点角标开待办面板:列出等待工单,「同意」「驳回」各发一条 Trigger", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      tickets: vi.fn(() => Promise.resolve([tv("t-w", "waiting", "本周投研先押 AI 还是消费？等你拍板。")])),
    });
    render(<DeskPet agent={agent} />);

    await user.click(await screen.findByRole("button", { name: "待办 1" }));

    const inbox = screen.getByRole("region", { name: "待办面板" });
    expect(inbox).toHaveTextContent("本周投研先押 AI 还是消费？等你拍板。");

    await user.click(screen.getByRole("button", { name: "同意" }));
    expect(agent.sendCommand).toHaveBeenCalledWith("同意 t-w");
    await user.click(screen.getByRole("button", { name: "驳回" }));
    expect(agent.sendCommand).toHaveBeenCalledWith("驳回 t-w");
  });

  it("桌宠旁可展开工单列表:每张工单带状态徽标", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      tickets: vi.fn(() =>
        Promise.resolve([
          tv("t-1", "progress", "两条线并行开工"),
          tv("t-2", "waiting", "等你拍板"),
          tv("t-3", "ready", "办完了"),
          tv("t-4", "blocked", "缺素材,卡住了"),
          tv("t-5", "failed", "模型报错"),
          tv("t-6", "dropped", "这条不做了"),
        ]),
      ),
    });
    render(<DeskPet agent={agent} />);

    await user.click(screen.getByRole("button", { name: "工单" }));

    const list = screen.getByRole("region", { name: "工单列表" });
    for (const label of ["进展", "等待", "就绪", "受阻", "失败", "已放弃"]) {
      expect(list).toHaveTextContent(label);
    }
    expect(list).toHaveTextContent("两条线并行开工");
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
    // 松手后高亮收起,等待 Worker 的分步汇报从 SSE 进来。
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

  it("待办面板的待审卡可写批注并发送 annotate;空批注不发送", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({
      tickets: vi.fn(() =>
        Promise.resolve([{ ticketId: "t-w", status: "waiting" as const, text: "草稿好了，进待审，等你过目。" }]),
      ),
    });
    render(<DeskPet agent={agent} />);

    await user.click(await screen.findByRole("button", { name: "待办 1" }));
    await user.type(screen.getByRole("textbox", { name: "批注" }), "第二句改口语一点");
    await user.click(screen.getByRole("button", { name: "发批注" }));

    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "pet",
      kind: "annotate",
      data: { ticketId: "t-w", note: "第二句改口语一点" },
    });

    // 空批注不发送。
    await user.click(screen.getByRole("button", { name: "发批注" }));
    expect(agent.sendTrigger).toHaveBeenCalledTimes(1);
  });
});

describe("放权模式与评估记录(工单 08)", () => {
  /** 评估记录样例:observe 下 R1 命中的「本来会做什么+为什么」。 */
  function evalRecord(): AgentEvalRecord {
    return {
      at: "2026-11-04T09:05:00.000Z",
      triggerId: "tr-1",
      ruleId: "R1",
      wouldDo: "自动起草本局复盘一句话",
      why: "对局刚结束，趁热提炼经理哪招值得学",
      outcome: "observed",
    };
  }

  it("待办面板顶部有三段开关:当前模式高亮,点「自动」切换并更新高亮", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);

    await user.click(screen.getByRole("button", { name: "待办" }));

    const group = screen.getByRole("group", { name: "放权模式" });
    expect(screen.getByRole("button", { name: "观察" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "关" })).toHaveAttribute("aria-pressed", "false");
    expect(group).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "自动" }));
    expect(agent.setAcceptMode).toHaveBeenCalledWith("auto");
    expect(screen.getByRole("button", { name: "自动" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "观察" })).toHaveAttribute("aria-pressed", "false");
  });

  it("评估记录列表:时间、规则、本来会做什么、为什么都可见", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent({ evals: vi.fn(() => Promise.resolve([evalRecord()])) });
    render(<DeskPet agent={agent} />);

    await user.click(screen.getByRole("button", { name: "待办" }));

    const list = await screen.findByRole("region", { name: "评估记录" });
    expect(list).toHaveTextContent("R1");
    expect(list).toHaveTextContent("自动起草本局复盘一句话");
    expect(list).toHaveTextContent("对局刚结束，趁热提炼经理哪招值得学");
    expect(list).toHaveTextContent(/:\d{2}/);
    expect(list).toHaveTextContent("只记录");
  });

  it("还没有评估记录时给空态文案;没有待办时面板可打开并显示空态", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    render(<DeskPet agent={agent} />);

    await user.click(screen.getByRole("button", { name: "待办" }));

    expect(screen.getByRole("region", { name: "评估记录" })).toHaveTextContent("还没有评估记录");
    expect(screen.getByRole("region", { name: "待办面板" })).toHaveTextContent("没有等你拍板的事");
  });

  it("演示经 policy 动作切过放权后(policySignal 变化),开着的面板开关立即同步", async () => {
    // 服务端模式先 observe;演示脚本(或别处)切到 auto 后,信号 +1 触发重拉。
    let mode: AgentPolicy["acceptMode"] = "observe";
    const agent = fakeAgent({ policy: vi.fn(() => Promise.resolve(emptyPolicy(mode))) });
    const { rerender } = render(<DeskPet agent={agent} focusPanel="inbox" />);

    await screen.findByRole("group", { name: "放权模式" });
    expect(screen.getByRole("button", { name: "观察" })).toHaveAttribute("aria-pressed", "true");

    mode = "auto";
    rerender(<DeskPet agent={agent} focusPanel="inbox" policySignal={1} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "自动" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("button", { name: "观察" })).toHaveAttribute("aria-pressed", "false");
    expect(agent.policy).toHaveBeenCalledTimes(2);
  });
});

describe("快捷芯片跳转与演示入口(工单 10→12)", () => {
  it("芯片 4 项不只回话:命令照发,跳转回调带动作被调用", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    const onQuickAction = vi.fn();
    render(<DeskPet agent={agent} onQuickAction={onQuickAction} />);

    for (const label of ["换个客户", "再来一局", "上局复盘", "本周投研"]) {
      // 点一枚芯片即收起;每次重新点头像展开。
      fireEvent.click(screen.getByRole("img", { name: /女版/ }));
      await user.click(screen.getByRole("button", { name: label }));
      expect(agent.sendCommand).toHaveBeenCalledWith(label);
      expect(onQuickAction).toHaveBeenCalledWith(label);
    }
    // 点完收起面板。
    expect(screen.queryByRole("region", { name: "对话面板" })).not.toBeInTheDocument();
  });

  it("focusPanel 让演示直接展开工单列表/待办面板/对话面板,强开待办同样拉放权数据", async () => {
    const { unmount } = render(<DeskPet agent={fakeAgent()} focusPanel="tickets" />);
    expect(screen.getByRole("region", { name: "工单列表" })).toBeInTheDocument();
    unmount();

    const agent = fakeAgent();
    render(<DeskPet agent={agent} focusPanel="inbox" />);
    expect(screen.getByRole("region", { name: "待办面板" })).toBeInTheDocument();
    await act(async () => {});
    expect(agent.policy).toHaveBeenCalled();
    unmount();

    render(<DeskPet agent={fakeAgent()} focusPanel="chat" />);
    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
  });

  it("演示代发对话(demoChatCue):打开面板并发送,如同玩家亲手输入", async () => {
    const agent = fakeAgent();
    render(
      <DeskPet
        agent={agent}
        demoChatCue={{ nonce: 1, text: "小贝，跟观众打个招呼" }}
        onDemoChatDone={() => undefined}
      />,
    );

    expect(screen.getByRole("region", { name: "对话面板" })).toBeInTheDocument();
    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "pet",
      kind: "chat",
      data: expect.objectContaining({ text: "小贝，跟观众打个招呼" }),
    });
    expect(screen.getByRole("log", { name: "对话记录" })).toHaveTextContent("小贝，跟观众打个招呼");
  });
});
