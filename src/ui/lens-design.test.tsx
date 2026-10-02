import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import type { ProductCore } from "../domain/product-core";
import type { Conversation, ConversationResult } from "../domain/types";
import { SEED_PERSONA_P02 } from "../domain/seed";
import { createInProcessProductCore } from "../product/in-process-product-api";
import { CallStep } from "./CallStep";
import { ResultStep } from "./ResultStep";

const call: Conversation = { id: "lens-call", personaId: "p01", status: "ongoing", turns: [], createdAt: "2026-10-02T00:00:00Z" };
const result: ConversationResult = {
  conversationId: call.id, observationFocus: "conditions", mainGoal: "未知", outcome: "未知", endReason: "客户主动结束通话", strategyPath: [],
  turns: [{ number: 1, speaker: "customer", text: "怎么取用，收益保证吗？" }, { number: 2, speaker: "manager", text: "这是我的实际回应，未确认用卡。" }],
};

describe("透镜改进:观察问题与两局对照", () => {
  it("复盘优先定位事实核对候选,不把提示当作已确认错误或合规认证", () => {
    const noted: ConversationResult = { ...result, turns: [...result.turns, { number: 3, speaker: "customer", text: "活动有啥条件" }, { number: 4, speaker: "manager", text: "活动也面向三方存管客户", factCheckNotes: ["活动对象与产品对象混用，需核对参数。"] }] };
    render(<ResultStep result={noted} onRestart={() => {}} />);
    expect(within(screen.getByLabelText("本局复盘起点")).getByRole("button", { name: "核对 T04" })).toBeInTheDocument();
    expect(screen.getByText("活动对象与产品对象混用，需核对参数。")).toBeInTheDocument();
    expect(screen.getByText(/候选不是已确认错误/)).toBeInTheDocument();
    expect(screen.getByText(/未记录疑点不代表通过事实核验/)).toBeInTheDocument();
  });
  it("从布置到结算保持玩家观察点,重试同客户后能展开两局原文", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: /到期资金·稳健阿姨/ }));
    await user.click(screen.getByRole("radio", { name: "核对条件" }));
    await user.click(screen.getByRole("button", { name: "接通电话,开始对局" }));
    expect(await screen.findByLabelText("本局观察点")).toHaveTextContent("经理怎样把条件说清楚");
    await user.type(await screen.findByLabelText("客户回复"), "规则怎么参加？{Enter}");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    const firstReview = await screen.findByLabelText("围绕观察点核对");
    expect(firstReview).toHaveTextContent("规则怎么参加？");
    const [original] = await api.listConversations();
    await user.click(screen.getByRole("button", { name: "同一客户再试" }));
    expect(await screen.findByLabelText("本局观察点")).toHaveTextContent("本局结算可与原局对照");
    await user.type(await screen.findByLabelText("客户回复"), "收益保证吗？{Enter}");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    const summary = await screen.findByText("两局对照 · 原局 → 本局");
    await user.click(summary);
    expect(await screen.findByLabelText("原局第1次回应")).toHaveTextContent("规则怎么参加？");
    expect(screen.getByLabelText("本局第1次回应")).toHaveTextContent("收益保证吗？");
    const newCall = (await api.listConversations()).find((c) => c.id !== original.id)!;
    expect(newCall).toMatchObject({ personaId: SEED_PERSONA_P02.id, observationFocus: "conditions", replayOfId: original.id });
    expect((await api.getConversation(original.id)).turns[0].text).toBe("规则怎么参加？");
  });

  it("缺少相关客户原话时不给观察动作盖章", () => {
    const unmatched = { ...result, turns: [{ number: 1, speaker: "customer" as const, text: "喂" }, result.turns[1]] };
    render(<ResultStep result={unmatched} onRestart={() => {}} />);
    expect(screen.getByLabelText("围绕观察点核对")).toHaveTextContent("尚未定位到");
    expect(screen.getByLabelText("围绕观察点核对")).toHaveTextContent("不据此判定经理做得好或不好");
  });

  it("查看旧局参数和素材证据时如实说明未保存当时记录", async () => {
    const user = userEvent.setup();
    render(<ResultStep result={{ ...result, strategyPath: [{ turnNumber: 2, cardId: "old-card", cardName: "旧卡", keyExpression: result.turns[1].text, customerText: result.turns[0].text, source: { materialTitle: "旧素材", turnRange: "T01–T02" }, sourceTurns: [] }] }} onRestart={() => {}} />);
    await user.click(screen.getByText(/经理第 1 轮 · T02/));
    expect(screen.getByText(/旧记录未保存当时来源片段/)).toBeVisible();
    await user.click(screen.getByText("核对参数 · 活动资格与产品取用"));
    expect(screen.getByText(/旧记录未保存当时产品参数/)).toBeVisible();
    expect(screen.getByText(/“无须立即转入”只说明报名时间安排/)).toBeVisible();
  });

  it("原局被清理不阻止本局复盘,重试加载后可显示原局", async () => {
    const user = userEvent.setup();
    const getResult = vi.fn().mockRejectedValueOnce(new Error("通话不存在")).mockResolvedValue({ ...result, conversationId: "original" });
    render(<ResultStep api={{ getResult } as unknown as ProductCore} result={{ ...result, replayOfId: "original" }} onRestart={() => {}} />);
    await user.click(screen.getByText("两局对照 · 原局 → 本局"));
    expect(await screen.findByRole("alert")).toHaveTextContent("仍可查看本局复盘");
    expect(screen.getByLabelText("围绕观察点核对")).toHaveTextContent("怎么取用，收益保证吗");
    await user.click(screen.getByRole("button", { name: "重试加载原局" }));
    expect(await screen.findByLabelText("原局第1次回应")).toHaveTextContent("怎么取用，收益保证吗");
  });
});

describe("透镜改进:阅读与草稿控制", () => {
  it("普通断网后核对已保存的客户句子,不把它恢复成重复待发发言", async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const pending = new Promise<Conversation>((_resolve, fail) => { reject = fail; });
    const saved = { ...call, turns: [{ number: 1, speaker: "customer" as const, text: "已发送句子" }, { number: 2, speaker: "manager" as const, text: "服务端已保存的回复" }] };
    const getConversation = vi.fn().mockResolvedValueOnce(call).mockResolvedValue(saved);
    render(<CallStep api={{ getConversation, sendCustomerTurn: () => pending } as unknown as ProductCore} conversationId={call.id} onFinished={() => {}} />);
    const input = await screen.findByLabelText("客户回复");
    await user.type(input, "已发送句子{Enter}");
    await user.type(input, "正在写的新草稿");
    await act(async () => reject(new Error("流式连接中断")));
    expect(await screen.findByText("服务端已保存的回复")).toBeInTheDocument();
    expect(input).toHaveValue("正在写的新草稿");
    expect(screen.queryByLabelText("未发出的回复")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("本轮已保存并同步");
  });

  it("网络中断且同步失败时暂缓发送,重新加载保存轮次后还保留新草稿", async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const pending = new Promise<Conversation>((_resolve, fail) => { reject = fail; });
    const saved = { ...call, turns: [{ number: 1, speaker: "customer" as const, text: "已经落库" }, { number: 2, speaker: "manager" as const, text: "恢复后的回复" }] };
    const getConversation = vi.fn().mockResolvedValueOnce(call).mockRejectedValueOnce(new Error("仍断网")).mockResolvedValue(saved);
    render(<CallStep api={{ getConversation, sendCustomerTurn: () => pending } as unknown as ProductCore} conversationId={call.id} onFinished={() => {}} />);
    const input = await screen.findByLabelText("客户回复");
    await user.type(input, "已经落库{Enter}");
    await user.type(input, "下一句草稿");
    await act(async () => reject(new Error("请求中断")));
    expect(screen.queryByLabelText("客户回复")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新加载通话" }));
    expect(await screen.findByLabelText("客户回复")).toHaveValue("下一句草稿");
    expect(screen.getByText("恢复后的回复")).toBeInTheDocument();
    expect(screen.queryByLabelText("未发出的回复")).not.toBeInTheDocument();
  });

  it("生成失败时保留正在写的新草稿,失败发言可以接回草稿", async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const pending = new Promise<Conversation>((_resolve, fail) => { reject = fail; });
    render(<CallStep api={{ getConversation: async () => call, sendCustomerTurn: () => pending } as unknown as ProductCore} conversationId={call.id} onFinished={() => {}} />);
    const input = await screen.findByLabelText("客户回复");
    await user.type(input, "原发言{Enter}");
    await user.type(input, "新草稿");
    await act(async () => reject(new Error("网络中断")));
    expect(input).toHaveValue("新草稿");
    expect(screen.getByLabelText("未发出的回复")).toHaveTextContent("原发言");
    await user.click(screen.getByRole("button", { name: "把失败发言接到草稿前" }));
    expect(input).toHaveValue("原发言\n新草稿");
  });

  it("有草稿时快捷回复只追加到输入框,不会偷偷发送并覆盖草稿", async () => {
    const user = userEvent.setup();
    const sendCustomerTurn = vi.fn();
    render(<CallStep api={{ getConversation: async () => call, sendCustomerTurn } as unknown as ProductCore} conversationId={call.id} onFinished={() => {}} />);
    const input = await screen.findByLabelText("客户回复");
    await user.type(input, "我想先问一下");
    await user.click(screen.getByRole("button", { name: "喂" }));
    expect(input).toHaveValue("我想先问一下\n喂");
    expect(sendCustomerTurn).not.toHaveBeenCalled();
  });

  it("阅读旧轮次时不追着流式增量滚动,可主动回到最新", async () => {
    const user = userEvent.setup();
    let delta!: (s: string) => void;
    let resolve!: (c: Conversation) => void;
    const pending = new Promise<Conversation>((done) => { resolve = done; });
    const api = { getConversation: async () => call, sendCustomerTurnStream: (_id: string, _text: string, onDelta: (s: string) => void) => { delta = onDelta; return pending; } } as unknown as ProductCore;
    render(<CallStep api={api} conversationId={call.id} onFinished={() => {}} />);
    await user.type(await screen.findByLabelText("客户回复"), "喂{Enter}");
    const log = screen.getByRole("list");
    const scrollTo = vi.fn();
    Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 0 }, scrollTo: { configurable: true, value: scrollTo } });
    fireEvent.scroll(log);
    await act(async () => delta("经理新回复"));
    expect(within(log).getByText("经理新回复")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "查看最新通话" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 });
    await act(async () => resolve({ ...call, turns: [{ number: 1, speaker: "customer", text: "喂" }, { number: 2, speaker: "manager", text: "经理新回复" }] }));
  });
});
