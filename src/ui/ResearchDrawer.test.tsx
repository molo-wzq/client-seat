import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createProductCore } from "../domain/product-core";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { InMemoryStorage } from "../product/in-process-product-api";
import { ResearchDrawer } from "./ResearchDrawer";

function renderDrawer() {
  const adapter = new FakeModelAdapter();
  const api = createProductCore({ copywriting: adapter, dialogue: adapter, storage: new InMemoryStorage() });
  return render(<ResearchDrawer api={api} />);
}

describe("投研抽屉", () => {
  it("浮层挂在页面根部，锁住背景滚动，Escape 退出后恢复焦点", async () => {
    const user = userEvent.setup();
    const { container } = renderDrawer();
    const trigger = screen.getByRole("button", { name: /宏观开场/ });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(dialog.parentElement).toHaveClass("closing");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("抽屉内点击保持打开，遮罩点击播放退出动画并关闭", async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole("button", { name: /行业轮动/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(dialog.parentElement).not.toHaveClass("closing");
    fireEvent.click(dialog.parentElement!);
    expect(dialog.parentElement).toHaveClass("closing");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
