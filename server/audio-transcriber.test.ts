import { afterEach, describe, expect, it, vi } from "vitest";
import { MimoAudioTranscriber, MimoSpeakerDiarizer, parseAudioFormat } from "./audio-transcriber";

afterEach(() => vi.unstubAllGlobals());

describe("后台录音转写适配器", () => {
  it("识别支持格式并拒绝其他文件", () => {
    expect(parseAudioFormat("call.M4A")).toBe("m4a");
    expect(() => parseAudioFormat("call.txt")).toThrow(/格式不支持/);
  });

  it("用独立文本调用整理说话人与轮次", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "T01 经理:您好。\nT02 客户:您说。" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const diarizer = new MimoSpeakerDiarizer({
      apiKey: "test",
      baseUrl: "https://example.test/v1",
      model: "mimo-v2.5",
    });

    const result = await diarizer.diarize("您好。您说。");

    expect(result).toContain("T02 客户:");
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]?.content).toContain("严格保留原文");
    expect(body.messages[1]).toEqual({ role: "user", content: "您好。您说。" });
  });

  it("按网关要求只发送音频,返回转写文字", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "T01 经理:您好。\nT02 客户:您说。" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const transcriber = new MimoAudioTranscriber({ apiKey: "test", baseUrl: "https://example.test/v1/" });
    const transcript = await transcriber.transcribe({ bytes: Buffer.from([1, 2, 3]), format: "m4a" });

    expect(transcript).toContain("T01 经理:");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string) as {
      messages: Array<{ content: Array<{ input_audio?: { data: string; format: string }; text?: string }> }>;
    };
    expect(body.messages[0]?.content[0]?.input_audio).toEqual({ data: "AQID", format: "m4a" });
    expect(body.messages[0]?.content).toHaveLength(1);
  });
});
