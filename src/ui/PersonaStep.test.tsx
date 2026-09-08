import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { createInProcessProductApi } from "../product/in-process-product-api";
import { PersonaStep } from "./PersonaStep";

describe("画像步骤", () => {
  it("从预设画像修改属性保存为自定义画像,并以此开始通话", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });
    const onStarted = vi.fn();
    render(<PersonaStep api={api} onStarted={onStarted} />);

    // 预设画像 P01 默认选中
    expect(await screen.findByText("代发·资金在证券")).toBeInTheDocument();

    // 修改属性:改名并把第一条可见信息切换为隐藏
    await user.click(screen.getByRole("button", { name: "修改属性" }));
    const nameInput = screen.getByLabelText("生客称呼");
    await user.clear(nameInput);
    await user.type(nameInput, "我的测试生客");
    await user.click(screen.getAllByRole("checkbox")[0]!);

    await user.click(screen.getByRole("button", { name: "保存为我的生客" }));
    expect(await screen.findByText("我的测试生客")).toBeInTheDocument();

    // 保存后的自定义画像直接开始通话
    await user.click(screen.getByRole("button", { name: "开始接听" }));
    expect(onStarted).toHaveBeenCalledWith(expect.any(String));

    // 画像确实以提交内容保存:第一条属性已归入隐藏
    const saved = (await api.listPersonas()).find((p) => p.name === "我的测试生客");
    expect(saved?.visible).toHaveLength(3);
    expect(saved?.hidden).toHaveLength(5);
  });

  it("全部属性留空也可以开始通话(保持未知,不自动补全)", async () => {
    const user = userEvent.setup();
    const api = createInProcessProductApi({ adapter: new FakeModelAdapter() });
    const onStarted = vi.fn();
    render(<PersonaStep api={api} onStarted={onStarted} />);

    expect(await screen.findByText("代发·资金在证券")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "修改属性" }));

    // 称呼与全部属性都留空
    await user.clear(screen.getByLabelText("生客称呼"));
    for (const input of screen.getAllByLabelText(/属性\d+/)) {
      await user.clear(input);
    }
    await user.click(screen.getByRole("button", { name: "保存为我的生客" }));
    expect(await screen.findByText("自定义生客")).toBeInTheDocument();

    const saved = (await api.listPersonas()).find((p) => p.visible.length === 0 && p.hidden.length === 0);
    expect(saved).toBeDefined();

    await user.click(screen.getByRole("button", { name: "开始接听" }));
    expect(onStarted).toHaveBeenCalledWith(expect.any(String));
  });
});
