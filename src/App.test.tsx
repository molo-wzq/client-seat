import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "./adapters/fake-model-adapter";
import { createInProcessProductApi } from "./product/in-process-product-api";
import { App } from "./App";

/**
 * 最高层端到端产品测试(spec.md 测试决策):只断言用户可观察行为,
 * 语言模型用伪实现驱动,保证可重复。
 */
describe("素材到模拟通话的核心闭环", () => {
  it("发布转写策略、接听生客电话并在结果中追溯所用策略卡", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });

    render(<App api={api} />);

    // 第一步:素材——示例转写稿已预填,生成结构化策略卡
    expect(screen.getByRole("heading", { name: "录音分析" })).toBeInTheDocument();
    const transcriptBox = screen.getByLabelText("电话转写稿") as HTMLTextAreaElement;
    expect(transcriptBox.value).toContain("拉新资金");

    await user.click(screen.getByRole("button", { name: "生成策略卡" }));
    expect(await screen.findByText("生客开场,自报身份先给退路")).toBeInTheDocument();
    expect(screen.getByText("只问现状,贴着回答找资金切入点")).toBeInTheDocument();
    expect(screen.getByText("默认选项预约报名,异议即解释,落到加微信")).toBeInTheDocument();
    expect(screen.getAllByText("草稿")).toHaveLength(3);

    // 人工确认后从草稿变为已发布,进入画像步骤
    await user.click(screen.getByRole("button", { name: /确认并发布/ }));
    expect(screen.getByRole("heading", { name: "创建一位生客" })).toBeInTheDocument();
    expect(await screen.findByText("代发·资金在证券")).toBeInTheDocument();

    // 第二步:画像——使用默认生客 P01 接听电话
    await user.click(screen.getByRole("button", { name: "开始接听" }));

    // 第三步:对话——生客输入"喂",AI 以理财经理身份开场
    const reply = screen.getByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText(/我是咱们银行的客户经理/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));

    // 第四步:结果——能看到本轮目标,并追溯到所用的已发布策略卡与原始片段
    expect(screen.getByRole("heading", { name: "这通电话是怎样推进的" })).toBeInTheDocument();
    expect(screen.getByText("生客开场,自报身份先给退路")).toBeInTheDocument();
    expect(screen.getByText(/T01–T02/)).toBeInTheDocument();
  });
});
