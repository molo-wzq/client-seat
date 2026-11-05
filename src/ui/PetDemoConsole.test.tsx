import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmitOutcome } from "../shared/agent-contract";
import type { AgentTriggerInput, AgentTicket } from "../shared/agent-contract";
import { DEMO_GAME_ID, DEMO_STEPS } from "./pet-demo";
import { PetDemoConsole } from "./PetDemoConsole";
import type { AgentClient } from "./agent-client";

/** 脚本步位:按动作特征找 beat,与文案解耦(改文案不用改测试)。 */
const HIDDEN_INDEX = DEMO_STEPS.findIndex((step) => step.actions.some((a) => a.kind === "scene" && a.scene === "hidden-cards"));
const GAME_ENDED_INDEX = DEMO_STEPS.findIndex((step) =>
  step.actions.some((a) => a.kind === "trigger" && a.input.kind === "game-ended"),
);
const PARALLEL_INDEX = DEMO_STEPS.findIndex((step) => step.actions.some((a) => a.kind === "command" && a.text.includes("并行")));
const DROPPED_INDEX = DEMO_STEPS.findIndex((step) =>
  step.actions.some((a) => a.kind === "trigger" && a.input.kind === "dropped"),
);
const ANNOTATE_INDEX = DEMO_STEPS.findIndex((step) => step.actions.some((a) => a.kind === "annotate-last-drop"));
/** 第⑦幕先切「观察」做对比,再切回「自动」;开场的 auto 在第①幕第一步(挂载即执行)。 */
const POLICY_OBSERVE_INDEX = DEMO_STEPS.findIndex((step) =>
  step.actions.some((a) => a.kind === "policy" && a.mode === "observe"),
);
const POLICY_AUTO_INDEX = DEMO_STEPS.findIndex(
  (step, index) => index > POLICY_OBSERVE_INDEX && step.actions.some((a) => a.kind === "policy" && a.mode === "auto"),
);
const MODEL_ERROR_INDEX = DEMO_STEPS.findIndex((step) =>
  step.actions.some((a) => a.kind === "trigger" && a.input.kind === "model-error"),
);

/** 触发结果按类型给样例:拖入落 waiting,game-ended 落 ready 带依据(复盘一句话从这来)。 */
function outcomeFor(input: AgentTriggerInput): EmitOutcome {
  if (input.kind === "dropped") {
    const ticket: AgentTicket = { id: "t-drop", triggerId: "tr-d", thread: { kind: "commandId", key: "tr-d" } };
    return { triggerId: "tr-d", admitted: true, ticket, report: { ticketId: "t-drop", status: "waiting", text: "草稿好了，进待审，等你过目。" } };
  }
  if (input.kind === "game-ended") {
    const ticket: AgentTicket = { id: "t-review", triggerId: "tr-g", thread: { kind: "gameId", key: DEMO_GAME_ID } };
    return {
      triggerId: "tr-g",
      admitted: true,
      ticket,
      report: { ticketId: "t-review", status: "ready", text: "第1轮先接住话头再往下谈，这招值得学。", basis: { gameId: DEMO_GAME_ID, turnNumber: 1, cardId: "c-window" } },
    };
  }
  return { triggerId: "tr-x", admitted: true, ticket: null, report: null };
}

function fakeAgent(): AgentClient {
  return {
    sendCommand: vi.fn(() => Promise.resolve()),
    sendTrigger: vi.fn((input: AgentTriggerInput) => Promise.resolve(outcomeFor(input))),
    onEvent: vi.fn(() => () => undefined),
    tickets: vi.fn(() => Promise.resolve([])),
    policy: vi.fn(() => Promise.resolve({ version: 1, acceptMode: "observe" as const, rules: [] })),
    setAcceptMode: vi.fn(() => Promise.resolve({ version: 2, acceptMode: "auto" as const, rules: [] })),
    evals: vi.fn(() => Promise.resolve([])),
  };
}

/**
 * 连点「下一步」推进 count 步(相对当前步);每步之间冲一次微任务,
 * 让上一步的触发结果先落地(批注要拿拖入工单的真实工单号)。
 */
async function stepForward(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await act(async () => {});
  }
}

/** 从第 1 步走到目标步(绝对步位,测试都从头开始)。 */
async function stepTo(target: number): Promise<void> {
  await stepForward(target);
}

afterEach(() => {
  vi.useRealTimers();
});

/** 约定测试缝:演示控制条组件交互(播放/暂停/下一步/重置/步骤说明/动作解释执行)。 */
describe("演示控制条(工单 10)", () => {
  it("右上控制条显示第 1 步/总步与首步说明,挂载即执行第 1 步的桌宠表情", () => {
    const agent = fakeAgent();
    const onPetExpression = vi.fn();
    render(<PetDemoConsole agent={agent} onPetExpression={onPetExpression} />);

    expect(screen.getByRole("region", { name: "演示控制条" })).toHaveTextContent(`第 1/${DEMO_STEPS.length} 步`);
    expect(screen.getByRole("region", { name: "演示控制条" })).toHaveTextContent(/入场/);
    expect(onPetExpression).toHaveBeenCalledWith("wave");
  });

  it("下一步推进:步数与说明更新,第一幕的打招呼走对话面板代发(工单 12)", async () => {
    const agent = fakeAgent();
    const onChat = vi.fn();
    render(<PetDemoConsole agent={agent} onChat={onChat} />);

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await act(async () => {});

    expect(screen.getByRole("region", { name: "演示控制条" })).toHaveTextContent(`第 2/${DEMO_STEPS.length} 步`);
    expect(onChat).toHaveBeenCalledWith("小贝，跟观众打个招呼");
  });

  it("播放按脚本节奏自动推进,暂停即停在当前步", () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    const onChat = vi.fn();
    render(<PetDemoConsole agent={agent} onChat={onChat} />);
    const bar = screen.getByRole("region", { name: "演示控制条" });

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    act(() => {
      vi.advanceTimersByTime(DEMO_STEPS[0].holdMs ?? 2400);
    });
    expect(bar).toHaveTextContent(`第 2/${DEMO_STEPS.length} 步`);

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(bar).toHaveTextContent(`第 2/${DEMO_STEPS.length} 步`);
    expect(onChat).toHaveBeenCalledWith("小贝，跟观众打个招呼");
  });

  it("自动播完停在总步并显示「演示完毕」,不越界", () => {
    vi.useFakeTimers();
    render(<PetDemoConsole agent={fakeAgent()} />);

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    // 每步到点才排下一步的计时器:分批推进,一批冲一格。
    for (let i = 0; i < DEMO_STEPS.length + 2; i += 1) {
      act(() => {
        vi.advanceTimersByTime(4000);
      });
    }

    const bar = screen.getByRole("region", { name: "演示控制条" });
    expect(bar).toHaveTextContent(/演示完毕/);
    expect(bar).toHaveTextContent(`${DEMO_STEPS.length}/${DEMO_STEPS.length} 步`);
  });

  it("重置回到第 1 步并还原舞台", async () => {
    render(<PetDemoConsole agent={fakeAgent()} />);
    await stepTo(3);
    expect(screen.getByRole("region", { name: "演示控制条" })).toHaveTextContent(`第 4/${DEMO_STEPS.length} 步`);

    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByRole("region", { name: "演示控制条" })).toHaveTextContent(`第 1/${DEMO_STEPS.length} 步`);
    expect(screen.getByRole("region", { name: "演示控制条" })).toHaveTextContent(/入场/);
  });

  it("第③/④幕:隐藏牌舞台可点「先藏着」,结算揭晓漏的信号并显示复盘一句话", async () => {
    render(<PetDemoConsole agent={fakeAgent()} />);

    await stepTo(HIDDEN_INDEX);
    const stage = screen.getByRole("region", { name: "演示舞台" });
    expect(stage).toHaveTextContent("已翻 1/3");
    fireEvent.click(screen.getByRole("button", { name: "先藏着" }));

    await stepForward(GAME_ENDED_INDEX - HIDDEN_INDEX);
    expect(screen.getByRole("region", { name: "演示舞台" })).toHaveTextContent("经理问到边上,但没追问下去");
    expect(screen.getByRole("region", { name: "演示舞台" })).toHaveTextContent("整局都没问到这个信号");
    expect(screen.getByRole("region", { name: "演示舞台" })).toHaveTextContent("先接住话头再往下谈，这招值得学");
  });

  it("第⑤幕:三张并行命令同时发出,并请 App 打开工单列表", async () => {
    const agent = fakeAgent();
    const onFocusPanel = vi.fn();
    render(<PetDemoConsole agent={agent} onFocusPanel={onFocusPanel} />);

    await stepTo(PARALLEL_INDEX);

    expect(agent.sendCommand).toHaveBeenCalledWith("并行：整理王姐素材要点");
    expect(agent.sendCommand).toHaveBeenCalledWith("并行：提炼上局复盘");
    expect(agent.sendCommand).toHaveBeenCalledWith("并行：总结本周投研");
    expect(onFocusPanel).toHaveBeenCalledWith("tickets");
  });

  it("第⑥幕:拖入录音发 dropped 触发,批注带着真实工单号唤醒原工单", async () => {
    const agent = fakeAgent();
    const onFocusPanel = vi.fn();
    render(<PetDemoConsole agent={agent} onFocusPanel={onFocusPanel} />);

    await stepTo(DROPPED_INDEX);
    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "materials",
      kind: "dropped",
      data: { fileName: "王姐通话.mp3", fileKind: "audio" },
    });

    await stepForward(ANNOTATE_INDEX - DROPPED_INDEX);
    expect(agent.sendTrigger).toHaveBeenCalledWith({
      source: "pet",
      kind: "annotate",
      data: { ticketId: "t-drop", note: "开头一句改得口语一点" },
    });
    expect(onFocusPanel).toHaveBeenCalledWith("inbox");
  });

  it("开场即切自动放权;第⑦幕先观察再切回自动,每次切换上报同步信号", async () => {
    const agent = fakeAgent();
    const onPolicyChange = vi.fn();
    render(<PetDemoConsole agent={agent} onPolicyChange={onPolicyChange} />);

    // 第①幕第一步挂载即执行:放权切「自动」,后面的复盘/起草才真的执行。
    expect(agent.setAcceptMode).toHaveBeenCalledWith("auto");
    await act(async () => {});
    expect(onPolicyChange).toHaveBeenCalledWith("auto");

    // 第⑦幕:先切「观察」(只记录不动手),再切回「自动」。
    await stepTo(POLICY_OBSERVE_INDEX);
    expect(agent.setAcceptMode).toHaveBeenCalledWith("observe");
    await stepForward(POLICY_AUTO_INDEX - POLICY_OBSERVE_INDEX);
    expect(agent.setAcceptMode).toHaveBeenLastCalledWith("auto");
    expect(onPolicyChange).toHaveBeenLastCalledWith("auto");

    // 模型报错触发仍走真实链路(受阻进待办由真实链路呈现)。
    await stepForward(MODEL_ERROR_INDEX - POLICY_AUTO_INDEX);
    expect(agent.sendTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ source: "system", kind: "model-error" }),
    );
  });
});
