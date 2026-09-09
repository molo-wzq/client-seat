import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Conversation, ConversationResult } from "../domain/types";
import type { ProductApi } from "../product/product-api";
import { CallStep } from "./CallStep";

function ongoingConversation(): Conversation {
  return {
    id: "conv-1",
    personaId: "p01",
    status: "ongoing",
    turns: [],
    createdAt: new Date().toISOString(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 只实现 CallStep 用到的三个方法,其余抛错以防误用。 */
function stubApi(sendImpl: () => Promise<Conversation>): ProductApi {
  const conversation = ongoingConversation();
  return {
    getConversation: async () => conversation,
    sendCustomerTurn: sendImpl,
    finishConversation: async () => ({ ...conversation, status: "ended" }),
    getResult: async () => ({}) as ConversationResult,
  } as unknown as ProductApi;
}

async function renderAndType(sendImpl: () => Promise<Conversation>) {
  const user = userEvent.setup();
  render(<CallStep api={stubApi(sendImpl)} conversationId="conv-1" onFinished={() => {}} />);
  const reply = await screen.findByLabelText("客户回复");
  await user.type(reply, "喂");
  await user.click(screen.getByRole("button", { name: "发送" }));
  return user;
}

describe("对话步骤的反馈", () => {
  it("发送后客户话立即上屏(乐观更新),等待期间显示思考提示", async () => {
    const pending = deferred<Conversation>();
    await renderAndType(() => pending.promise);

    // 请求未返回,客户话已出现在通话记录,且显示加载提示
    expect(screen.getByText("喂")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("理财经理正在思考…");
    expect((screen.getByLabelText("客户回复") as HTMLTextAreaElement).value).toBe("");
  });

  it("请求成功后用服务端会话替换乐观状态", async () => {
    const pending = deferred<Conversation>();
    await renderAndType(() => pending.promise);

    pending.resolve({
      ...ongoingConversation(),
      turns: [
        { number: 1, speaker: "customer", text: "喂" },
        { number: 2, speaker: "manager", text: "您好,我是咱们银行的客户经理。" },
      ],
    });
    expect(await screen.findByText(/我是咱们银行的客户经理/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("请求失败时回滚:客户话撤下、草稿恢复、显示错误", async () => {
    const pending = deferred<Conversation>();
    await renderAndType(() => pending.promise);

    pending.reject(new Error("网络中断"));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络中断");
    // 通话记录中不再出现这条客户话;它恢复为输入框草稿
    expect(within(screen.getByRole("list")).queryByText("喂")).not.toBeInTheDocument();
    expect((screen.getByLabelText("客户回复") as HTMLTextAreaElement).value).toBe("喂");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
