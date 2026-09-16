import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationResult } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
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
function stubApi(sendImpl: () => Promise<Conversation>): ProductCore {
  const conversation = ongoingConversation();
  return {
    getConversation: async () => conversation,
    sendCustomerTurn: sendImpl,
    finishConversation: async () => ({ ...conversation, status: "ended" }),
    getResult: async () => ({}) as ConversationResult,
  } as unknown as ProductCore;
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

    // 请求未返回,客户话已出现在通话记录(chips 里也有「喂」,按列表范围断言),且显示加载提示
    expect(within(screen.getByRole("list")).getByText("喂")).toBeInTheDocument();
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

  it("等待 AI 回复期间按 Enter 不会并发发送(按钮 disable 挡不住键盘路径)", async () => {
    const pending = deferred<Conversation>();
    const sendImpl = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    render(<CallStep api={stubApi(sendImpl)} conversationId="conv-1" onFinished={() => {}} />);
    const reply = await screen.findByLabelText("客户回复");

    await user.type(reply, "喂{Enter}");
    await user.type(reply, "再补一句{Enter}");

    expect(sendImpl).toHaveBeenCalledTimes(1);

    pending.resolve({
      ...ongoingConversation(),
      turns: [
        { number: 1, speaker: "customer", text: "喂" },
        { number: 2, speaker: "manager", text: "您好,我是咱们银行的客户经理。" },
      ],
    });
    await screen.findByText(/我是咱们银行的客户经理/);
    // busy 复位后可继续发送
    await user.type(reply, "好的{Enter}");
    expect(sendImpl).toHaveBeenCalledTimes(2);
  });
});

describe("流式话术上屏(票 29)", () => {
  it("话术增量逐段出现在流式气泡,完成后被权威轮次替换", async () => {
    const finalConversation = () => ({
      ...ongoingConversation(),
      turns: [
        { number: 1, speaker: "customer" as const, text: "喂" },
        { number: 2, speaker: "manager" as const, text: "您好,我是咱们银行的客户经理。" },
      ],
    });
    // 增量同步推完,但权威会话挂起:让流式中间态可断言。
    const pending = deferred<Conversation>();
    const api = {
      getConversation: async () => ongoingConversation(),
      sendCustomerTurnStream: async (
        _id: string,
        _text: string,
        onDelta: (d: string) => void,
      ) => {
        onDelta("您好,我是");
        onDelta("咱们银行的客户经理。");
        return pending.promise;
      },
      finishConversation: async () => ({ ...ongoingConversation(), status: "ended" as const }),
      getResult: async () => ({}) as never,
    } as unknown as ProductCore;

    const user = userEvent.setup();
    render(<CallStep api={api} conversationId="conv-1" onFinished={() => {}} />);
    const reply = await screen.findByLabelText("客户回复");
    await user.type(reply, "喂");
    await user.click(screen.getByRole("button", { name: "发送" }));

    // 增量已拼进流式气泡,busy 仍持续(等待提示在场)。
    expect(await screen.findByText("您好,我是咱们银行的客户经理。")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    pending.resolve(finalConversation());
    // done 落地:权威轮次出现,流式气泡被替换(文本不重复出现两次),busy 复位。
    await waitFor(() => {
      const log = screen.getByRole("list");
      expect(within(log).getAllByText(/咱们银行的客户经理/)).toHaveLength(1);
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});

describe("快捷回复与消息操作(票 31)", () => {
  it("点击快捷回复 chip 直接发送该句,经理回复上屏", async () => {
    const sendImpl = async () => ({
      ...ongoingConversation(),
      turns: [
        { number: 1, speaker: "customer" as const, text: "喂" },
        { number: 2, speaker: "manager" as const, text: "您好,我是咱们银行的客户经理。" },
      ],
    });
    const user = userEvent.setup();
    render(<CallStep api={stubApi(sendImpl)} conversationId="conv-1" onFinished={() => {}} />);
    // 空会话 → 开场 chips
    const chip = await screen.findByRole("button", { name: "喂" });
    await user.click(chip);
    expect(await screen.findByText(/我是咱们银行的客户经理/)).toBeInTheDocument();
  });

  it("经理话术带复制按钮,点击后短暂显示已复制", async () => {
    const sendImpl = async () => ({
      ...ongoingConversation(),
      turns: [
        { number: 1, speaker: "customer" as const, text: "喂" },
        { number: 2, speaker: "manager" as const, text: "您好,方便聊两句吗?" },
      ],
    });
    const user = userEvent.setup();
    render(<CallStep api={stubApi(sendImpl)} conversationId="conv-1" onFinished={() => {}} />);
    const chip = await screen.findByRole("button", { name: "喂" });
    await user.click(chip);
    const copyBtn = await screen.findByRole("button", { name: /复制第2轮/ });
    await user.click(copyBtn);
    expect(copyBtn).toHaveTextContent("已复制");
  });
});
