import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "./adapters/fake-model-adapter";
import { createInProcessProductApi } from "./product/in-process-product-api";
import { SCORING_PATTERN } from "./test/scoring-pattern";
import { App } from "./App";

/**
 * 最高层端到端产品测试(spec.md 测试决策):只断言用户可观察行为,
 * 语言模型用伪实现驱动,保证可重复。
 */
describe("素材到模拟通话的核心闭环", () => {
  it("发布转写策略、入座接通并在结算中追溯所用策略卡", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: /对局布置/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /素材库/ }));
    expect(await screen.findByRole("heading", { name: "录音分析" })).toBeInTheDocument();
    const transcriptBox = screen.getByLabelText("电话转写稿") as HTMLTextAreaElement;
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
    expect(await screen.findByText(/我是咱们银行的客户经理/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));

    expect(await screen.findByRole("heading", { name: "这通电话是怎样推进的" })).toBeInTheDocument();
    expect(screen.getByText("生客开场,自报身份先给退路")).toBeInTheDocument();
    expect(screen.getByText(/T01–T02/)).toBeInTheDocument();
    expect(screen.getByText("本轮主要目标")).toBeInTheDocument();
    expect(screen.getByText("沟通结果")).toBeInTheDocument();
    expect(screen.getByText("结束原因")).toBeInTheDocument();
    expect(screen.getAllByText(/我是咱们银行的客户经理/).length).toBeGreaterThan(0);
    expect(screen.getByText(/只解释 AI 的打法,不评价你的客户表现/)).toBeInTheDocument();
    expect(screen.queryByText(SCORING_PATTERN)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再来一局" })).toBeInTheDocument();
  });
});

describe("快速开始", () => {
  it("跳过素材流程直接进对局,并可立即开始一轮对练", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);
    await user.click(screen.getByRole("button", { name: "快速开始一通对话" }));

    expect(await screen.findByRole("heading", { name: /对局/ })).toBeInTheDocument();
    const reply = screen.getByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText(/我是咱们银行的客户经理/)).toBeInTheDocument();
  });
});
