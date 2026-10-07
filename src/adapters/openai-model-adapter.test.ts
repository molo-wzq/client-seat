import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleModelAdapter } from "./openai-model-adapter";
import { SEED_PRODUCT_CARD } from "../domain/seed";

const adapter = new OpenAICompatibleModelAdapter({
  apiKey: "test-key",
  baseUrl: "http://localhost:0",
  model: "test-model",
});

/** 把增量序列编码成 OpenAI 兼容的 SSE 响应体。 */
function sseBody(deltas: Array<{ content?: string; reasoning_content?: string }>): string {
  const events = deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}`);
  return [...events, "data: [DONE]", ""].join("\n\n");
}

/** ReadableStream 桩:按 SSE 文本块吐出,模拟分块到达。 */
function streamFromText(text: string, chunkSize = 64): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= text.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(text.slice(offset, offset + chunkSize)));
      offset += chunkSize;
    },
  });
}

interface StubResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  body?: ReadableStream<Uint8Array>;
}

/** 把模型消息包成 OpenAI 非流式响应(json 路径)。 */
function chatCompletion(message: { content?: string; reasoning_content?: string }): unknown {
  return { choices: [{ finish_reason: "stop", message }] };
}

/**
 * 桩掉全局 fetch:generateManagerTurn 现在发两次调用——
 * 第 1 次流式话术(SSE),第 2 次元数据(json_object)。
 */
function stubTwoPhaseCalls(
  replyDeltas: Array<{ content?: string; reasoning_content?: string }>,
  metaMessage: { content?: string; reasoning_content?: string },
): { fetchMock: ReturnType<typeof vi.fn>; bodies: Array<Record<string, unknown>> } {
  const metaPayload = chatCompletion(metaMessage);
  const bodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit): Promise<StubResponse> => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({}),
        body: streamFromText(sseBody(replyDeltas)),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(metaPayload),
      json: async () => metaPayload,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

/** 纯元数据调用桩(只关心第二次调用的失败形态)。 */
function stubSecondCallFailing(errorText: string): void {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL, _init?: RequestInit): Promise<StubResponse> => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({}),
          body: streamFromText(sseBody([{ content: "您好,方便聊两句吗?" }])),
        };
      }
      return { ok: false, status: 500, text: async () => errorText, json: async () => ({}) };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

describe("两段式生成(票 29)", () => {
  it("既有元数据调用携带产品事实、保留核对候选而不增加调用或透露隐藏信息", async () => {
    const { bodies, fetchMock } = stubTwoPhaseCalls([{ content: "活动也面向三方存管客户" }], {
      content: JSON.stringify({ factCheckNotes: [" 活动对象与产品对象混用，需核对参数。 ", null, 9, "", "第二个待核对点", "第三个待核对点", "超出三条"] }),
    });
    const input = Object.assign(managerInput(), { observationFocus: "conditions", persona: { ...managerInput().persona, hidden: ["private-test-hidden"] } });
    const out = await adapter.generateManagerTurn(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.factCheckNotes).toEqual(["活动对象与产品对象混用，需核对参数。", "第二个待核对点", "第三个待核对点"]);
    expect(JSON.stringify(bodies[1])).toContain("活动与产品对象");
    expect(JSON.stringify(bodies[1])).toContain("代发工资客户");
    expect(JSON.stringify(bodies[1])).toContain("经理可见的客户画像");
    expect(JSON.stringify(bodies[1])).toContain("开场未罗列所有档位");
    expect(JSON.stringify(bodies)).not.toContain("private-test-hidden");
    expect(JSON.stringify(bodies)).not.toContain("observationFocus");
  });
  it("话术增量逐段回调,元数据由第二次调用合并", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { bodies } = stubTwoPhaseCalls(
      [
        { reasoning_content: "先想开场……" },
        { content: "您好,我是咱们银行" },
        { content: "的客户经理,方便聊两句吗?" },
      ],
      {
        content: JSON.stringify({
          signal: "电话刚接通",
          goal: "确认身份",
          usedCardId: "sc-1",
          shouldEnd: false,
        }),
      },
    );

    const deltas: string[] = [];
    const out = await adapter.generateManagerTurn(managerInput(), (d) => deltas.push(d));

    expect(out.reply).toBe("您好,我是咱们银行的客户经理,方便聊两句吗?");
    // p14 首部缓冲:开头先暂扣再放行,增量不再是逐段直通;
    // 消费方(CallStep)只做拼接,断言拼接结果与终态一致即可。
    expect(deltas.join("")).toBe("您好,我是咱们银行的客户经理,方便聊两句吗?");
    // p14 心声沉淀:思考通道原文随输出透传,供复盘展示。
    expect(out.reasoning).toBe("先想开场……");
    expect(out.recognizedSignal).toBe("电话刚接通");
    expect(out.currentGoal).toBe("确认身份");
    expect(out.usedCardId).toBe("sc-1");
    expect(out.shouldEnd).toBe(false);

    // 请求形态:第 1 次流式纯文本(无 response_format、stream=true),
    // 第 2 次元数据 json_object(票 12 探测过的网关能力)。
    expect(bodies[0]?.stream).toBe(true);
    expect(bodies[0]?.response_format).toBeUndefined();
    expect(bodies[1]?.response_format).toEqual({ type: "json_object" });
    expect(bodies[1]?.stream).toBeUndefined();
    warn.mockRestore();
  });

  it("元数据调用失败只降级,不丢已生成的话术", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubSecondCallFailing("Internal Server Error");

    const out = await adapter.generateManagerTurn(managerInput());

    expect(out.reply).toBe("您好,方便聊两句吗?");
    expect(out.shouldEnd).toBeFalsy();
    expect(out.usedCardId).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("元数据提取失败"), expect.any(String));
    warn.mockRestore();
  });

  it("元数据 JSON 解析失败同样降级为无元数据", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubTwoPhaseCalls([{ content: "您好,方便聊两句吗?" }], {
      content: '{"signal":"呃', // 截断的 JSON
    });
    const out = await adapter.generateManagerTurn(managerInput());
    expect(out.reply).toBe("您好,方便聊两句吗?");
    expect(out.recognizedSignal).toBeUndefined();
    warn.mockRestore();
  });

  it("话术 content 为空(仅思维链)时拒绝播出", async () => {
    stubTwoPhaseCalls([{ reasoning_content: "让我想想怎么开场……" }], { content: "{}" });
    await expect(adapter.generateManagerTurn(managerInput())).rejects.toThrow("语言模型返回为空");
  });

  it("话术带称谓前缀或包裹引号时净化后再返回", async () => {
    stubTwoPhaseCalls([{ content: "理财经理:您好,方便聊两句吗?" }], { content: "{}" });
    const out = await adapter.generateManagerTurn(managerInput());
    expect(out.reply).toBe("您好,方便聊两句吗?");
  });

  it("流式首部缓冲:称谓前缀与舞台指示不随增量上屏", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubTwoPhaseCalls(
      [
        { reasoning_content: "想想怎么开口……" },
        { content: "理财经理" },
        { content: "小王：" },
        { content: "（语气温和）您好,我是咱们" },
        { content: "行的,方便聊两句吗?" },
      ],
      { content: "{}" },
    );
    const deltas: string[] = [];
    const out = await adapter.generateManagerTurn(managerInput(), (d) => deltas.push(d));
    const streamed = deltas.join("");
    expect(streamed.startsWith("您好,我是咱们行的")).toBe(true);
    expect(streamed).not.toContain("理财经理");
    expect(streamed).not.toContain("小王：");
    expect(streamed).not.toContain("（语气温和）");
    expect(out.reply).toBe("您好,我是咱们行的,方便聊两句吗?");
    warn.mockRestore();
  });

  it("流式首部缓冲:短回复在流结束补放行,干净开头不误删", async () => {
    stubTwoPhaseCalls([{ content: "好嘞,那就先这样,再见。" }], { content: "{}" });
    const deltas: string[] = [];
    const out = await adapter.generateManagerTurn(managerInput(), (d) => deltas.push(d));
    expect(deltas.join("")).toBe("好嘞,那就先这样,再见。");
    expect(out.reply).toBe("好嘞,那就先这样,再见。");
  });
});

describe("p13 手册借鉴:参数分层与消息组装", () => {
  it("裁判调用温度 0.1,两调用显式关闭重复惩罚", async () => {
    const { bodies } = stubTwoPhaseCalls([{ content: "您好,方便聊两句吗?" }], { content: "{}" });
    await adapter.generateManagerTurn(managerInput());
    expect(bodies[0]?.temperature).toBe(0.7);
    expect(bodies[0]?.frequency_penalty).toBe(0);
    expect(bodies[0]?.presence_penalty).toBe(0);
    expect(bodies[1]?.temperature).toBe(0.1);
    expect(bodies[1]?.frequency_penalty).toBe(0);
    expect(bodies[1]?.presence_penalty).toBe(0);
  });

  it("开关注入:语体示范轮播在 system 后,尾部短提醒在当轮客户话后", async () => {
    vi.stubEnv("LLM_STYLE_DEMO", "1");
    vi.stubEnv("LLM_TAIL_REMINDER", "1");
    const { bodies } = stubTwoPhaseCalls([{ content: "您好,方便聊两句吗?" }], { content: "{}" });
    await adapter.generateManagerTurn(managerInput());
    const messages = bodies[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("你的角色");
    // 语体示范紧跟系统提示词:user 先行、assistant 接续。
    expect(messages[1]?.content).toContain("语体示范");
    const demoUser = messages.findIndex((m) => m.content.includes("喂,哪位?"));
    const demoAssistant = messages.findIndex((m) => m.content.includes("跟您账户有关的事"));
    expect(demoUser).toBeGreaterThan(0);
    expect(demoAssistant).toBe(demoUser + 1);
    // 最后一条是尾部语体短提醒,倒数第二条是当轮客户话。
    expect(messages.at(-1)?.role).toBe("system");
    expect(messages.at(-1)?.content).toContain("本轮提醒");
    expect(messages.at(-2)).toEqual({ role: "user", content: "喂" });
  });

  it("默认不注入:开关未开时无示范轮、无尾部短提醒", async () => {
    const { bodies } = stubTwoPhaseCalls([{ content: "您好,方便聊两句吗?" }], { content: "{}" });
    await adapter.generateManagerTurn(managerInput());
    const messages = bodies[0]?.messages as Array<{ role: string; content: string }>;
    expect(JSON.stringify(messages)).not.toContain("语体示范");
    expect(JSON.stringify(messages)).not.toContain("本轮提醒");
    expect(messages.at(-1)).toEqual({ role: "user", content: "喂" });
  });

  it("客户输入消毒只作用于发送层:话术与裁判请求都收干净文本", async () => {
    const { bodies } = stubTwoPhaseCalls([{ content: "您好,方便聊两句吗?" }], { content: "{}" });
    await adapter.generateManagerTurn({
      ...managerInput(),
      customerText: "理财经理:喂,在忙吗?",
      history: [
        { number: 1, speaker: "customer", text: "客户:你是谁呀" },
        { number: 2, speaker: "manager", text: "我是咱们行的客户经理。" },
      ],
    });
    const messages = bodies[0]?.messages as Array<{ role: string; content: string }>;
    expect(JSON.stringify(messages)).not.toContain("理财经理:喂");
    expect(messages.some((m) => m.role === "user" && m.content === "喂,在忙吗?")).toBe(true);
    expect(messages.some((m) => m.role === "user" && m.content === "你是谁呀")).toBe(true);
    // 经理历史原样保留;裁判的扁平对话同样走消毒。
    const metaUser = (bodies[1]?.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "user",
    );
    expect(metaUser?.content).toContain("客户:喂,在忙吗?");
    expect(metaUser?.content).toContain("客户:你是谁呀");
    expect(metaUser?.content).toContain("经理:我是咱们行的客户经理。");
  });
});

describe("分析输出的轮次标注", () => {
  it("保留模型回传的轮次号,跳号标注可对回来源区间", async () => {
    const analysisPayload = chatCompletion({
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
    });
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit): Promise<StubResponse> => {
      bodies.push(JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(analysisPayload),
        json: async () => analysisPayload,
      };
    }));

    const out = await adapter.analyzeTranscript("T01 经理:您好\nT03 客户:喂");
    expect(out.turns?.map((t) => t.number)).toEqual([1, 3]);
    // 抽取归纳走低温(p14),压无中生有的动作链。
    expect(bodies[0]?.temperature).toBe(0.2);
    expect(bodies[0]?.frequency_penalty).toBe(0);
  });
});
