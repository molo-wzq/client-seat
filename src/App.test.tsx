import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("素材到模拟通话的核心闭环", () => {
  it("让用户发布转写策略、接听生客电话并追溯策略", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByRole("heading", { name: "录音分析" })).toBeInTheDocument();
    expect(screen.getByLabelText("电话转写稿")).toHaveValue(
      expect.stringContaining("我现在不考虑理财"),
    );

    await user.click(screen.getByRole("button", { name: "生成策略卡" }));
    expect(screen.getByText("降低客户防御")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认并发布" }));
    expect(screen.getByRole("heading", { name: "创建一位生客" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始接听" }));
    const reply = screen.getByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByText(/第一次联系您/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结束并查看结果" }));
    expect(screen.getByRole("heading", { name: "这通电话是怎样推进的" })).toBeInTheDocument();
    expect(screen.getByText("生客首次触达策略")).toBeInTheDocument();
  });
});
