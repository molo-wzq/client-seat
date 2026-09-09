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

    await user.click(screen.getByRole("button", { name: "载入示例" }));
    await user.click(screen.getByRole("button", { name: "生成策略卡" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在分析转写稿,可能需要 1–2 分钟…");
  });

  it("画像步:保存画像期间显示「正在保存画像」", async () => {
    const pending = deferred<Persona>();
    const api = { savePersona: () => pending.promise } as unknown as ProductApi;
    const user = userEvent.setup();
    render(<PersonaStep api={api} personas={[STUB_PERSONA]} onSaved={() => {}} />);

    await user.click(screen.getByRole("button", { name: "修改属性" }));
    await user.click(screen.getByRole("button", { name: "保存为我的生客" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在保存画像…");
  });

  it("快速开始:准备期间显示「正在准备对话」", async () => {
    const pending = deferred<Conversation>();
    const api = {
      quickStart: () => pending.promise,
      listPersonas: async () => [],
      listMaterials: async () => [],
      listConversations: async () => [],
    } as unknown as ProductApi;
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "快速开始一通对话" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在准备对话…");
  });
});
