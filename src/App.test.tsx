import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FakeModelAdapter } from "./adapters/fake-model-adapter";
import type { ProductCore } from "./domain/product-core";
import { createInProcessProductCore } from "./product/in-process-product-api";
import { SCORING_PATTERN } from "./test/scoring-pattern";
import { App } from "./App";
import type { AgentClient } from "./ui/agent-client";
import type { AgentReport, AgentTriggerInput } from "../server/agent/types";

/**
 * 最高层端到端产品测试(spec.md 测试决策):只断言用户可观察行为,
 * 语言模型用伪实现驱动,保证可重复。
 */
describe("素材到模拟通话的核心闭环", () => {
  it("发布转写策略、入座接通并在结算中追溯所用策略卡", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: /对局布置/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /素材库/ }));
    expect(await screen.findByRole("heading", { name: "录音分析" })).toBeInTheDocument();
    // 新素材从空稿开始,示例需显式载入(票 21)
    const transcriptBox = screen.getByLabelText("电话转写稿") as HTMLTextAreaElement;
    expect(transcriptBox.value).toBe("");
    await user.click(screen.getByRole("button", { name: "载入示例" }));
    expect(transcriptBox.value).toContain("拉新资金");
    expect(screen.getByLabelText("素材类型")).toHaveValue("顺利沟通");

    await user.click(screen.getByRole("button", { name: "生成策略卡" }));
    expect(await screen.findByText("生客开场,自报身份先给退路")).toBeInTheDocument();
    expect(screen.getByText("只问现状,贴着回答找资金切入点")).toBeInTheDocument();
    expect(screen.getByText("默认选项预约报名,异议即解释,落到加微信")).toBeInTheDocument();
    expect(screen.getAllByText("草稿")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: /确认并发布/ }));
    expect((await screen.findAllByText("已发布")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "新对局(布置)" }));
    expect(await screen.findByRole("heading", { name: /对局布置/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /代发·资金在证券/ }));
    await user.click(screen.getByRole("button", { name: "接通电话,开始对局" }));

    const reply = await screen.findByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText(/我是咱们行的理财经理小王/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));

    expect(await screen.findByRole("heading", { name: "这通电话是怎样推进的" })).toBeInTheDocument();
    await user.click(screen.getByText(/经理第 1 轮 · T02/));
    expect(within(document.getElementById("review-turn-2")!).getByText("生客开场,自报身份先给退路", { selector: "strong" })).toBeVisible();
    expect(screen.getByText(/T01–T02/)).toBeInTheDocument();
    expect(screen.getByText("开局目标")).toBeInTheDocument();
    expect(screen.getByText('最后动作（候选）')).toBeInTheDocument();
    expect(screen.getByText("沟通结果")).toBeInTheDocument();
    expect(screen.getByText("结束原因")).toBeInTheDocument();
    expect(screen.getAllByText(/我是咱们行的理财经理小王/).length).toBeGreaterThan(0);
    expect(screen.getByText(/只解释 AI 的打法,不评价你的客户表现/)).toBeInTheDocument();
    expect(screen.queryByText(SCORING_PATTERN)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再来一局" })).toBeInTheDocument();
  });
});

describe("快速开始", () => {
  it("跳过素材流程直接进对局,并可立即开始一轮对练", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));

    expect(await screen.findByRole("heading", { name: /对局/ })).toBeInTheDocument();
    const reply = screen.getByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText(/我是咱们行的理财经理小王/)).toBeInTheDocument();
  });
});

describe("进行中对局可找回", () => {
  async function startOngoingCall(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));
    expect(await screen.findByRole("heading", { name: /对局/ })).toBeInTheDocument();
    const reply = screen.getByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText(/我是咱们行的理财经理小王/);
  }

  it("另接新电话后,旧的进行中通话仍可从通话记录回到桌面继续", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);
    await startOngoingCall(user);

    await user.click(screen.getByRole("button", { name: "新对局(布置)" }));
    await user.click(screen.getByRole("button", { name: /到期资金·稳健阿姨/ }));
    await user.click(screen.getByRole("button", { name: "接通电话,开始对局" }));
    expect(await screen.findByLabelText("客户回复")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /通话记录/ }));
    expect(within(await screen.findByRole("list")).getAllByText("进行中")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /代发·资金在证券/ }));

    expect(await screen.findByLabelText("客户回复")).toBeInTheDocument();
    expect(screen.getByText(/我是咱们行的理财经理小王/)).toBeInTheDocument();
  });

  it("离开并结束另一通电话后,左栏「进行中的通话」可从目录找回旧通话", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);
    await startOngoingCall(user);

    await user.click(screen.getByRole("button", { name: "新对局(布置)" }));
    await user.click(screen.getByRole("button", { name: /到期资金·稳健阿姨/ }));
    await user.click(screen.getByRole("button", { name: "接通电话,开始对局" }));
    const reply = await screen.findByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText(/我是咱们行的理财经理小王/);
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(await screen.findByRole("heading", { name: "这通电话是怎样推进的" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "再来一局" }));
    expect(await screen.findByRole("heading", { name: /对局布置/ })).toBeInTheDocument();

    const resume = screen.getByRole("button", { name: "进行中的通话" });
    expect(resume).toBeEnabled();
    await user.click(resume);
    expect(await screen.findByLabelText("客户回复")).toBeInTheDocument();
    expect(screen.getByText(/我是咱们行的理财经理小王/)).toBeInTheDocument();
  });
});

describe("左栏口径与标签", () => {
  it("策略卡计数只算已发布;通话结束后左栏按钮变为「查看结算」", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /素材库/ }));
    await user.click(await screen.findByRole("button", { name: "载入示例" }));
    await user.click(screen.getByRole("button", { name: "生成策略卡" }));
    expect(await screen.findByText("生客开场,自报身份先给退路")).toBeInTheDocument();
    // 3 张草稿尚未发布:左栏不计数,与布置桌口径一致
    expect(screen.getByRole("button", { name: "策略卡(0)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /确认并发布/ }));
    expect((await screen.findAllByText("已发布")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "策略卡(3)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "快速开始一通对话" }));
    const reply = await screen.findByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText(/我是咱们行的理财经理小王/);
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(await screen.findByRole("heading", { name: "这通电话是怎样推进的" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看结算" })).toBeInTheDocument();
  });
});

describe("桌宠复盘一句话(工单 06)", () => {
  /** 假桌宠 agent:记录 sendTrigger,按本次触发的 data 回一条复盘 Report。 */
  function petAgentWith(reportFor: (input: AgentTriggerInput) => AgentReport) {
    const sendTrigger = vi.fn((input: AgentTriggerInput) =>
      Promise.resolve({ triggerId: "tr-1", admitted: true, ticket: null, report: reportFor(input) }),
    );
    const agent = {
      sendCommand: vi.fn(() => Promise.resolve()),
      sendTrigger,
      onEvent: vi.fn(() => () => undefined),
      tickets: vi.fn(() => Promise.resolve([])),
    } as unknown as AgentClient;
    return { agent, sendTrigger };
  }

  /** 快速开始一通,喂一句就结束并进结算。 */
  async function finishQuickCall(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));
    const reply = await screen.findByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText(/我是咱们行的理财经理小王/);
    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(await screen.findByRole("heading", { name: "这通电话是怎样推进的" })).toBeInTheDocument();
  }

  it("对局一结束自动发 game-ended 触发;插槽显示一句话可展开,桌宠变 cheer", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    const { agent, sendTrigger } = petAgentWith((input) => ({
      ticketId: "t-1",
      status: "ready",
      text: "第1轮先接住话头再往下谈，这招值得学。",
      basis: {
        gameId: String(input.data.gameId),
        turnNumber: 1,
        cardId: (input.data.rounds as Array<{ cardId?: string }>)[0]?.cardId,
      },
    }));
    render(<App api={api} agent={agent} />);

    await finishQuickCall(user);

    // 自动发送的触发:table 来源、game-ended 类型,带本局各轮经理话术与未翻开隐藏牌数。
    expect(sendTrigger).toHaveBeenCalledTimes(1);
    const input = sendTrigger.mock.calls[0][0] as AgentTriggerInput;
    expect(input.source).toBe("table");
    expect(input.kind).toBe("game-ended");
    expect(typeof input.data.gameId).toBe("string");
    expect(input.data.rounds).toEqual([
      expect.objectContaining({ managerText: expect.stringContaining("理财经理小王") }),
    ]);
    expect(typeof input.data.hiddenUnrevealedCount).toBe("number");

    // 结算页插槽:一句话 + 展开依据(第 1 轮 · 策略卡)。
    expect(screen.getByRole("heading", { name: "桌宠复盘" })).toBeInTheDocument();
    expect(screen.getByText("第1轮先接住话头再往下谈，这招值得学。")).toBeInTheDocument();
    await user.click(screen.getByText("展开依据"));
    expect(screen.getByText(/^第 1 轮 · 策略卡『/)).toBeInTheDocument();

    // 桌宠对局结束后变欢呼(spec 故事 7)。
    expect(document.querySelector(".desk-pet")).toHaveAttribute("data-expression", "cheer");
  });

  it("复盘没有值得说的内容(dropped):照样发触发,但结算页不出插槽", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    const { agent, sendTrigger } = petAgentWith(() => ({
      ticketId: "t-1",
      status: "dropped",
      text: "这局没有单独值得学的招，先不多说。",
    }));
    render(<App api={api} agent={agent} />);

    await finishQuickCall(user);

    expect(sendTrigger).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "桌宠复盘" })).not.toBeInTheDocument();
  });
});

describe("目录加载反馈与重试", () => {
  it("首屏显示加载提示;失败时给出错误与重试,重试成功后正常渲染", async () => {
    const user = userEvent.setup();
    const real = createInProcessProductCore({ adapter: new FakeModelAdapter() });
    let fail = true;
    const api = {
      listPersonas: () => (fail ? Promise.reject(new Error("网络不可用")) : real.listPersonas()),
      listMaterials: () => (fail ? Promise.reject(new Error("网络不可用")) : real.listMaterials()),
      listConversations: () => (fail ? Promise.reject(new Error("网络不可用")) : real.listConversations()),
    } as unknown as ProductCore;

    render(<App api={api} />);

    expect(screen.getByText("正在准备桌面…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("目录加载失败:网络不可用");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();

    // 重试仍失败:错误保持可见
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目录加载失败:网络不可用");

    fail = false;
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: /对局布置/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("操作错误可以一键关闭", async () => {
    const user = userEvent.setup();
    const api = {
      listPersonas: () => Promise.resolve([]),
      listMaterials: () => Promise.resolve([]),
      listConversations: () => Promise.resolve([]),
      quickStart: () => Promise.reject(new Error("接通失败")),
    } as unknown as ProductCore;

    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("接通失败");

    await user.click(screen.getByRole("button", { name: "关闭错误提示" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
