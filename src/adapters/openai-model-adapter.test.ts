import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleModelAdapter } from "./openai-model-adapter";
import { SEED_PRODUCT_CARD } from "../domain/seed";

const adapter = new OpenAICompatibleModelAdapter({
  apiKey: "test-key",
  baseUrl: "http://localhost:0",
  model: "test-model",
});

/** 桩掉全局 fetch,返回指定载荷的 chat/completions 响应。 */
function stubChat(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function managerInput(customerText = "喂") {
  return {
    persona: { id: "p", name: "p", visible: ["代发客户"] },
    publishedCards: [],
    product: SEED_PRODUCT_CARD,
    history: [],
    customerText,
  };
}

describe("推理模型输出兜底", () => {
  it("content 为空、reasoning_content 含结构化 JSON 时采用 reasoning 输出", async () => {
    stubChat({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: "",
            reasoning_content:
              '{"signal":"电话接通","goal":"确认身份","reply":"您好,我是客户经理,方便吗?","shouldEnd":false}',
          },
        },
      ],
    });
    const out = await adapter.generateManagerTurn(managerInput());
    expect(out.reply).toBe("您好,我是客户经理,方便吗?");
    expect(out.recognizedSignal).toBe("电话接通");
    expect(out.shouldEnd).toBe(false);
  });

  it("content 为空且 reasoning 非 JSON 时报错,不把思维链当对话播出", async () => {
    stubChat({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "", reasoning_content: "让我想想这个开场该怎么设计……" },
        },
      ],
    });
    await expect(adapter.generateManagerTurn(managerInput())).rejects.toThrow(/JSON|reply/);
  });

  it("content 与 reasoning 均为空时报「返回为空」", async () => {
    stubChat({ choices: [{ finish_reason: "stop", message: { content: "" } }] });
    await expect(adapter.generateManagerTurn(managerInput())).rejects.toThrow("语言模型返回为空");
  });
});

describe("JSON 输出模式(票 12)", () => {
  it("对话请求发送 response_format=json_object,转写分析请求不发送", async () => {
    const managerPayload = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: '{"signal":"无","goal":"确认时机","reply":"您好,方便聊两句吗?","shouldEnd":false}',
          },
        },
      ],
    };
    const analystPayload = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              '{"analysis":{"scenario":"s","customerState":"c","overallGoal":"g","stages":[],"strengths":[],"weaknesses":[],"actualResult":"r","reusableConditions":[]},"cards":[{"id":"sc-1","name":"n"}]}',
          },
        },
      ],
    };
    const payloads = [managerPayload, analystPayload];
    const fetchMock = vi.fn(async (_url: string | URL | RequestInit, _init?: RequestInit) => {
      const payload = payloads.at(fetchMock.mock.calls.length - 1) ?? managerPayload;
      return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
    });
    vi.stubGlobal("fetch", fetchMock);

    await adapter.generateManagerTurn(managerInput());
    await adapter.analyzeTranscript("T01 经理:你好。\nT02 客户:什么事?");

    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>,
    );
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[1].response_format).toBeUndefined();
  });
});

describe("对话输出校验", () => {
  it("合法 JSON 缺 reply 字段时报错,不把 JSON 当话术播出", async () => {
    stubChat({
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"signal":"无","goal":"收口","shouldEnd":true}' },
        },
      ],
    });
    await expect(adapter.generateManagerTurn(managerInput())).rejects.toThrow(/reply/);
  });

  it("被截断的 JSON 输出报错,不当纯文本播出", async () => {
    stubChat({
      choices: [
        {
          finish_reason: "length",
          message: { content: '{"signal":"无","reply":"您好' },
        },
      ],
    });
    await expect(adapter.generateManagerTurn(managerInput())).rejects.toThrow(/不完整/);
  });

  it("纯文本输出降级为无元数据的一轮对话", async () => {
    stubChat({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "您好,我是客户经理,方便聊两句吗?" },
        },
      ],
    });
    const out = await adapter.generateManagerTurn(managerInput());
    expect(out.reply).toBe("您好,我是客户经理,方便聊两句吗?");
    expect(out.shouldEnd).toBeFalsy();
  });
});

describe("分析输出的轮次标注", () => {
  it("保留模型回传的轮次号,跳号标注可对回来源区间", async () => {
    stubChat({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              turns: [
                { speaker: "manager", text: "您好", number: 1 },
                { speaker: "customer", text: "喂", number: 3 },
              ],
              analysis: {
                scenario: "s",
                customerState: "c",
                overallGoal: "g",
                stages: [],
                strengths: [],
                weaknesses: [],
                actualResult: "r",
                reusableConditions: [],
              },
              cards: [{ id: "sc-1", name: "n" }],
            }),
          },
        },
      ],
    });
    const out = await adapter.analyzeTranscript("T01 经理:您好\nT03 客户:喂");
    expect(out.turns?.map((t) => t.number)).toEqual([1, 3]);
  });
});
