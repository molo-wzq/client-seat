import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import type { ProductCore } from "../domain/product-core";
import type { Conversation, ConversationResult } from "../domain/types";
import { SEED_PERSONA_P02 } from "../domain/seed";
import { createInProcessProductCore } from "../product/in-process-product-api";
import { HistoryView } from "./CatalogViews";
import { ResultStep } from "./ResultStep";

describe("界面透镜：切换保持玩家控制", () => {
  it("到策略页查资料再回通话,未发草稿保留且焦点回到主要内容", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));
    await user.type(await screen.findByLabelText("客户回复"), "还没发的追问");
    await user.click(screen.getByRole("button", { name: /策略卡/ }));
    expect(screen.getByRole("heading", { name: "策略卡" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "客户回复" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "进行中的通话" }));
    expect(await screen.findByRole("textbox", { name: "客户回复" })).toHaveValue("还没发的追问");
    expect((await api.listConversations())[0].turns).toHaveLength(0);
    expect(screen.getByRole("button", { name: "进行中的通话" })).toHaveAttribute("aria-current", "page");
  });

  it("后台通话结束不会打断正在查阅的页面,可主动查看结算", async () => {
    const user = userEvent.setup();
    const real = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    let resolveReply!: (call: Conversation) => void;
    const pending = new Promise<Conversation>((resolve) => { resolveReply = resolve; });
    const api: ProductCore = { ...real, sendCustomerTurnStream: () => pending };
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));
    await user.type(await screen.findByLabelText("客户回复"), "喂{Enter}");
    const [call] = await real.listConversations();
    await user.click(screen.getByRole("button", { name: /策略卡/ }));
    const ended = await real.finishConversation(call.id);
    await act(async () => resolveReply(ended));
    await waitFor(() => expect(screen.getByRole("button", { name: "查看结算" })).toBeEnabled());
    expect(screen.getByRole("heading", { name: "策略卡" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "这通电话是怎样推进的" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看结算" }));
    expect(await screen.findByRole("heading", { name: "这通电话是怎样推进的" })).toBeVisible();
  });
});

describe("界面透镜：历史可辨认与定位", () => {
  const records: Conversation[] = Array.from({ length: 13 }, (_, index) => ({
    id: `history-${index}`, personaId: SEED_PERSONA_P02.id, status: index === 0 ? "ongoing" : "ended",
    createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T08:00:00Z`,
    promptVersion: "p11",
    turns: [{ number: 1, speaker: "customer", text: index === 4 ? "我要找的取用问题" : `开场 ${index}` }, { number: 2, speaker: "manager", text: "实际回应" }],
  }));
  it("同名记录显示时间与轮次,新复盘不被旧进行中挡住,更多记录仍能找到", async () => {
    const user = userEvent.setup();
    render(<HistoryView conversations={records} personas={[SEED_PERSONA_P02]} onOpen={() => {}} />);
    const list = screen.getByRole("list");
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(12);
    expect(rows[0]).toHaveTextContent("已结束");
    expect(rows[0]).toHaveTextContent("结束原因未记录");
    expect(rows[0]).toHaveTextContent("2026/10/13");
    expect(rows[0]).toHaveTextContent("1 轮经理回应");
    await user.click(screen.getByRole("button", { name: /显示更多记录/ }));
    expect(within(list).getAllByRole("button")).toHaveLength(13);
    expect(within(list).getAllByRole("button").at(-1)).toHaveTextContent("进行中");
    expect(records[0].id).toBe("history-0");
  });

  it("按原话检索并按状态筛选,空结果有恢复提示", async () => {
    const user = userEvent.setup();
    let opened: Conversation | undefined;
    render(<HistoryView conversations={records} personas={[SEED_PERSONA_P02]} onOpen={(call) => { opened = call; }} />);
    await user.type(screen.getByRole("searchbox", { name: "查找通话" }), "取用问题");
    const row = within(screen.getByRole("list")).getByRole("button");
    await user.click(row);
    expect(opened?.id).toBe("history-4");
    await user.selectOptions(screen.getByRole("combobox", { name: "通话状态" }), "ongoing");
    expect(screen.getByText(/没有符合条件的记录/)).toBeVisible();
    await user.clear(screen.getByRole("searchbox", { name: "查找通话" }));
    expect(within(screen.getByRole("list")).getAllByRole("button")).toHaveLength(1);
  });
});

it("复盘核对展开正确轮次,回放展开完整原文并移动键盘焦点", async () => {
  const user = userEvent.setup();
  const result: ConversationResult = {
    conversationId: "review", mainGoal: "解释条件", outcome: "客户追问", endReason: "主动结束", strategyPath: [],
    turns: [{ number: 1, speaker: "customer", text: "取用要等吗？" }, { number: 2, speaker: "manager", text: "按实际条件办理", factCheckNotes: ["核对取用条件"] }],
  };
  render(<ResultStep result={result} onRestart={() => {}} />);
  const review = document.getElementById("review-turn-2")!;
  expect(review).not.toHaveAttribute("open");
  await user.click(within(screen.getByLabelText("本局复盘起点")).getByRole("button", { name: "核对 T02" }));
  expect(review).toHaveAttribute("open");
  expect(within(review).getByText("核对取用条件")).toBeVisible();
  expect(review.querySelector("summary")).toHaveFocus();
  await user.click(within(review).getByRole("button", { name: "回放原文" }));
  expect(document.getElementById("result-transcript")).toHaveAttribute("open");
  expect(document.getElementById("result-turn-2")).toHaveFocus();
  expect(document.getElementById("result-turn-2")).toBeVisible();
  expect(screen.queryByText("已复盘")).not.toBeInTheDocument();
});
