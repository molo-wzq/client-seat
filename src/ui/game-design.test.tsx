import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import type { ProductCore } from "../domain/product-core";
import { SEED_CARDS, SEED_PERSONA_P02, SEED_PERSONA_P03 } from "../domain/seed";
import type { Conversation, ConversationResult } from "../domain/types";
import { createInProcessProductCore } from "../product/in-process-product-api";
import { CallStep, quickReplies } from "./CallStep";
import { ResultStep } from "./ResultStep";
import { StrategyRail } from "./TavernRail";

const conversation: Conversation = {
  id: "audit-call", personaId: SEED_PERSONA_P03.id, status: "ongoing", turns: [], createdAt: "2026-10-02T00:00:00Z",
};
const emptyResult: ConversationResult = {
  conversationId: conversation.id, mainGoal: "未知", outcome: "未知", endReason: "客户主动结束通话", turns: [], strategyPath: [],
};

describe("开局与重玩闭环", () => {
  it("入座可读完整画像,同一客户重试保留原局并新建空白对局", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: /到期资金·稳健阿姨/ }));
    expect(screen.getByText(SEED_PERSONA_P02.visible[1])).toBeInTheDocument();
    await user.click(screen.getByText("查看你的隐藏牌 · 仅你知情"));
    expect(screen.getByText(SEED_PERSONA_P02.hidden[0])).toBeVisible();
    await user.click(screen.getByRole("button", { name: "接通电话,开始对局" }));
    await screen.findByLabelText("客户回复");
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(await screen.findByText(/你在经理回应前结束了通话/)).toBeInTheDocument();
    const [original] = await api.listConversations();
    await user.click(screen.getByRole("button", { name: "同一客户再试" }));
    await screen.findByLabelText("客户回复");
    const calls = await api.listConversations();
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.personaId === SEED_PERSONA_P02.id)).toBe(true);
    expect(await api.getConversation(original.id)).toMatchObject({ status: "ended", turns: [] });
    expect(calls.find((c) => c.id !== original.id)).toMatchObject({ status: "ongoing", turns: [] });
  });
});

describe("客户行动不中断", () => {
  it("停止流式显示后同步服务端已保存轮次,不把已发送的话恢复成待发草稿", async () => {
    const user = userEvent.setup();
    let resolveSync!: (c: Conversation) => void;
    const sync = new Promise<Conversation>((resolve) => { resolveSync = resolve; });
    const api = {
      getConversation: vi.fn().mockResolvedValueOnce(conversation).mockImplementation(() => sync),
      sendCustomerTurnStream: async (_id: string, _text: string, _delta: (d: string) => void, signal: AbortSignal) => new Promise<Conversation>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("已停止", "AbortError")));
      }),
    } as unknown as ProductCore;
    render(<CallStep api={api} conversationId={conversation.id} onFinished={() => {}} />);
    await user.type(await screen.findByLabelText("客户回复"), "喂{Enter}");
    await user.click(screen.getByRole("button", { name: /停止/ }));
    expect(screen.getByRole("status")).toHaveTextContent("正在同步本轮通话");
    await act(async () => resolveSync({ ...conversation, turns: [
      { number: 1, speaker: "customer", text: "喂" },
      { number: 2, speaker: "manager", text: "这一轮已保存的经理回复" },
    ] }));
    expect(await screen.findByText("这一轮已保存的经理回复")).toBeInTheDocument();
    expect(screen.getByLabelText("客户回复")).toHaveValue("");
  });

  it("离开旧对局后,迟到的经理回复不能把新客户替换掉", async () => {
    const user = userEvent.setup();
    const real = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    let resolveReply!: (c: Conversation) => void;
    const pending = new Promise<Conversation>((resolve) => { resolveReply = resolve; });
    const api: ProductCore = { ...real, sendCustomerTurnStream: async () => pending };
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));
    const input = await screen.findByLabelText("客户回复");
    const [old] = await real.listConversations();
    await user.type(input, "喂{Enter}");
    await user.click(screen.getByRole("button", { name: "新对局(布置)" }));
    await user.click(screen.getByRole("button", { name: /到期资金·稳健阿姨/ }));
    await user.click(screen.getByRole("button", { name: "接通电话,开始对局" }));
    await screen.findByLabelText("客户回复");
    await act(async () => resolveReply({ ...old, turns: [
      { number: 1, speaker: "customer", text: "喂" },
      { number: 2, speaker: "manager", text: "旧对局的迟到回复" },
    ] }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "到期资金·稳健阿姨" })).toBeInTheDocument());
    expect(screen.queryByText("旧对局的迟到回复")).not.toBeInTheDocument();
    // 再给 microtask 一轮处理，不能仅在旧异步回调之前断言。
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(await screen.findByRole("button", { name: "同一客户再试" })).toBeInTheDocument();
    expect(screen.queryByText("旧对局的迟到回复")).not.toBeInTheDocument();
  });

  it("加载失败原地重试,未加载的通话不能发送", async () => {
    const user = userEvent.setup();
    const getConversation = vi.fn().mockRejectedValueOnce(new Error("暂时断网")).mockResolvedValue(conversation);
    const api = { getConversation } as unknown as ProductCore;
    render(<CallStep api={api} conversationId={conversation.id} onFinished={() => {}} />);
    expect(screen.queryByLabelText("客户回复")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时断网");
    await user.click(screen.getByRole("button", { name: "重新加载通话" }));
    expect(await screen.findByLabelText("客户回复")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("中文输入法确认候选不发送,确认完毕后 Enter 才发送", async () => {
    const sendCustomerTurn = vi.fn().mockResolvedValue(conversation);
    const api = { getConversation: async () => conversation, sendCustomerTurn } as unknown as ProductCore;
    render(<CallStep api={api} conversationId={conversation.id} onFinished={() => {}} />);
    const input = await screen.findByLabelText("客户回复");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
    expect(sendCustomerTurn).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(sendCustomerTurn).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(sendCustomerTurn).toHaveBeenCalledWith(conversation.id, "你好"));
  });

  it("结束落库成功但结果失败时锁定发言,可重试查看复盘", async () => {
    const user = userEvent.setup();
    const ended = { ...conversation, status: "ended" as const, endReason: "客户主动结束通话" };
    const finishConversation = vi.fn().mockResolvedValue(ended);
    const getResult = vi.fn().mockRejectedValueOnce(new Error("复盘暂不可用")).mockResolvedValue(emptyResult);
    const onFinished = vi.fn();
    const api = { getConversation: async () => conversation, finishConversation, getResult } as unknown as ProductCore;
    render(<CallStep api={api} conversationId={conversation.id} onFinished={onFinished} />);
    await screen.findByLabelText("客户回复");
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("复盘暂不可用");
    expect(screen.queryByLabelText("客户回复")).not.toBeInTheDocument();
    expect(screen.getByText(/通话已结束:客户主动结束通话/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(finishConversation).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(emptyResult);
  });
});

describe("证据与客户事实不误导", () => {
  it("资金金额不会误触产品快捷回复,话少客户不被写成炒股客户", () => {
    const replies = quickReplies({ ...conversation, turns: [{ number: 2, speaker: "manager", text: "您那笔15万接下来怎么安排?" }] }, [SEED_PERSONA_P03]);
    expect(replies).toContain("你想了解哪方面?");
    expect(replies.join(" ")).not.toMatch(/股市|报名|报上|存着定期/);
    const opening = quickReplies({ ...conversation, turns: [{ number: 2, speaker: "manager", text: "我是理财经理小李，行里有个活动，您现在方便吗?" }] }, [SEED_PERSONA_P03]);
    expect(opening.join(" ")).not.toMatch(/收益|取用|报名|立减金/);
    const stranger = { ...SEED_PERSONA_P02, visible: ["年长客户，与经理首次接触"] };
    expect(quickReplies({ ...conversation, personaId: stranger.id }, [stranger])).not.toContain("喂,是小李啊");
  });

  it("明牌不把动作链首项当作本轮事实,未匹配也不提示等待", () => {
    const card = { ...SEED_CARDS[0], status: "published" as const };
    const view = render(<StrategyRail cards={[card]} activeCardId={card.id} hasManagerTurn matchBasis="对应征询时机动作" slam={null} />);
    expect(screen.getByText("卡内动作参考")).toBeInTheDocument();
    expect(screen.getByText("对应征询时机动作")).toBeInTheDocument();
    view.rerender(<StrategyRail cards={[card]} hasManagerTurn slam={null} />);
    expect(screen.getByText(/本轮用卡未确认/)).toBeInTheDocument();
    expect(screen.queryByText("等待经理亮牌")).not.toBeInTheDocument();
  });

  it("复盘优先核对卡外数字,计数只包含经理实际轮次", () => {
    const result: ConversationResult = { ...emptyResult, turns: [
      { number: 1, speaker: "customer", text: "喂" },
      { number: 2, speaker: "manager", text: "您好" },
      { number: 3, speaker: "customer", text: "利息多少?" },
      { number: 4, speaker: "manager", text: "收益5%", outOfCardFact: true },
    ] };
    render(<ResultStep result={result} onRestart={() => {}} />);
    const focus = within(screen.getByLabelText("本局复盘起点"));
    expect(focus.getByRole("button", { name: "核对 T04" })).toBeInTheDocument();
    expect(focus.getByText(/2 轮经理回应 · 0 轮有策略卡记录 · 1 轮标记卡外数字/)).toBeInTheDocument();
    expect(focus.getByText(/标记本身不等于已确认错误/)).toBeInTheDocument();
  });
});
