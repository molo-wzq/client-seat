import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvalRecord, AgentEvent, AgentPolicy, AgentTicketView } from "../shared/agent-contract";
import { DeskPet, type PetExpression } from "./DeskPet";
import type { AgentClient } from "./agent-client";

// 桌宠把版式、勿扰、位置都记在 localStorage,测试间互不串扰。
beforeEach(() => {
  window.localStorage.clear();
});

/** 假 agent 客户端(工单 03 测试缝):记录各接口调用;放权与评估缺省给空实现。 */
function fakeAgent(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    sendCommand: vi.fn(() => Promise.resolve()),
    sendTrigger: vi.fn(() =>
      Promise.resolve({ triggerId: "tr-x", admitted: true, ticket: null, report: null }),
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
    let listener: ((event: AgentEvent) => void) | undefined;
    const agent = fakeAgent({
      onEvent: (l) => {
        listener = l;
        return () => undefined;
      },
    });
    render(<DeskPet agent={agent} />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /^待办 \d+$/ })).not.toBeInTheDocument();

    act(() => {
      listener?.({ type: "report", report: { ticketId: "t-w", status: "waiting", text: "等你拍板" } });
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

describe("快捷环跳转与演示入口(工单 10)", () => {
  it("快捷环 4 项不只回话:命令照发,跳转回调带动作被调用", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    const onQuickAction = vi.fn();
    render(<DeskPet agent={agent} onQuickAction={onQuickAction} />);

    for (const label of ["换个客户", "再来一局", "上局复盘", "本周投研"]) {
      // 点一项快捷环即收起;每次重新点头像展开。
      fireEvent.click(screen.getByRole("img", { name: /女版/ }));
      await user.click(screen.getByRole("button", { name: label }));
      expect(agent.sendCommand).toHaveBeenCalledWith(label);
      expect(onQuickAction).toHaveBeenCalledWith(label);
    }
    // 点完收起快捷环。
    expect(screen.queryByRole("button", { name: "换个客户" })).not.toBeInTheDocument();
  });

  it("命令条输入「演示」唤出演示,不发命令;普通命令照发", async () => {
    const user = userEvent.setup();
    const agent = fakeAgent();
    const onOpenDemo = vi.fn();
    render(<DeskPet agent={agent} onOpenDemo={onOpenDemo} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await user.type(screen.getByRole("textbox", { name: "命令条" }), "演示{Enter}");
    expect(onOpenDemo).toHaveBeenCalledTimes(1);
    expect(agent.sendCommand).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await user.type(screen.getByRole("textbox", { name: "命令条" }), "换个客户{Enter}");
    expect(agent.sendCommand).toHaveBeenCalledWith("换个客户");
  });

  it("focusPanel 让演示直接展开工单列表/待办面板,强开待办同样拉放权数据", async () => {
    const { unmount } = render(<DeskPet agent={fakeAgent()} focusPanel="tickets" />);
    expect(screen.getByRole("region", { name: "工单列表" })).toBeInTheDocument();
    unmount();

    const agent = fakeAgent();
    render(<DeskPet agent={agent} focusPanel="inbox" />);
    expect(screen.getByRole("region", { name: "待办面板" })).toBeInTheDocument();
    await act(async () => {});
    expect(agent.policy).toHaveBeenCalled();
  });
});
