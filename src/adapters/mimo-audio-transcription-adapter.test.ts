import { afterEach, describe, expect, it, vi } from "vitest";
import { MimoAudioTranscriptionAdapter } from "./mimo-audio-transcription-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("MIMO 录音转写适配器", () => {
  it("发送音频与说话人指令,返回规范化转写文字", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "T01 经理:您好。\nT02 客户:您说。" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new MimoAudioTranscriptionAdapter({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1/",
    });

    const transcript = await adapter.transcribeAudio({
      fileName: "call.m4a",
      mediaType: "audio/mp4",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(transcript).toContain("T01 经理:");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      messages: Array<{ content: Array<{ type: string; input_audio?: { data: string; format: string }; text?: string }> }>;
    };
    expect(body.model).toBe("mimo-v2.5-asr");
    expect(body.messages[0]?.content[0]?.input_audio).toEqual({ data: "AQID", format: "m4a" });
    expect(body.messages[0]?.content[1]?.text).toContain("逐句区分说话人");
  });

  it("服务失败时显式报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, text: async () => "temporarily unavailable" })),
    );
    const adapter = new MimoAudioTranscriptionAdapter({ apiKey: "test-key", baseUrl: "https://example.test/v1" });
    await expect(
      adapter.transcribeAudio({ fileName: "call.mp3", mediaType: "audio/mpeg", bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/HTTP 503/);
  });
});
