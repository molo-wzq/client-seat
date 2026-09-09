import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import type { Conversation, Material, Persona } from "../domain/types";
import type { ProductApi } from "../product/product-api";
import { MaterialStep } from "./MaterialStep";
import { PersonaStep } from "./PersonaStep";

/** 各处等待点的 BusyHint 文案断言(票15①):请求未返回时必须可见。 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const STUB_PERSONA: Persona = {
  id: "p01",
  name: "测试生客",
  visible: ["代发客户"],
  hidden: [],
};

describe("加载提示", () => {
  it("素材步:分析期间显示「正在分析转写稿」", async () => {
    const pending = deferred<Material>();
    const api = { analyzeTranscript: () => pending.promise } as unknown as ProductApi;
    const user = userEvent.setup();
    render(<MaterialStep api={api} onPublished={() => {}} />);

    await user.click(screen.getByRole("button", { name: "生成策略卡" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在分析转写稿,可能需要 1–2 分钟…");
  });

  it("画像步:开始接听期间显示「正在接通」", async () => {
    const pending = deferred<Conversation>();
    const api = {
      listPersonas: async () => [STUB_PERSONA],
      startConversation: () => pending.promise,
    } as unknown as ProductApi;
    const user = userEvent.setup();
    render(<PersonaStep api={api} onStarted={() => {}} />);

    expect(await screen.findByText("测试生客")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始接听" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在接通…");
  });

  it("快速开始:准备期间显示「正在准备对话」", async () => {
    const pending = deferred<Conversation>();
    const api = { quickStart: () => pending.promise } as unknown as ProductApi;
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(screen.getByRole("button", { name: "快速开始一通对话" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在准备对话…");
  });
});
