import { describe, expect, it } from "vitest";
import { FailoverModelAdapter } from "./failover-model-adapter";
import type { CopywritingPort, DialoguePort, TranscriptAnalysis } from "../domain/ports";

/** 可编程的端口替身:按脚本抛错/返回,并记录调用与流式增量。 */
function makePort(overrides?: {
  dialogueError?: Error;
  dialogueDeltasBeforeError?: string[];
  analysisError?: Error;
  streamError?: Error;
  streamDeltasBeforeError?: string[];
}) {
  const calls = { dialogue: 0, analysis: 0, completeStream: 0 };
  const dialogue: DialoguePort = {
    async generateManagerTurn(_input, onReplyDelta?) {
      calls.dialogue += 1;
      for (const delta of overrides?.dialogueDeltasBeforeError ?? []) {
        onReplyDelta?.(delta);
      }
      if (overrides?.dialogueError) throw overrides.dialogueError;
      return { reply: `reply-${calls.dialogue}` };
    },
  };
  const copywriting: CopywritingPort = {
    async analyzeTranscript(): Promise<TranscriptAnalysis> {
      calls.analysis += 1;
      if (overrides?.analysisError) throw overrides.analysisError;
      return { analysis: {} as TranscriptAnalysis["analysis"], cards: [] };
    },
  };
  const streaming = {
    async completeStream(_messages: Array<{ role: string; content: string }>, onDelta?: (delta: string) => void) {
      calls.completeStream += 1;
      for (const delta of overrides?.streamDeltasBeforeError ?? []) {
        onDelta?.(delta);
      }
      if (overrides?.streamError) throw overrides.streamError;
      return `stream-${calls.completeStream}`;
    },
  };
  return { ...dialogue, ...copywriting, ...streaming, calls };
}

describe("FailoverModelAdapter(工单 13:按角色的 fallback 链)", () => {
  it("主模型对话成功时不触碰备用", async () => {
    const primary = makePort();
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);

    const out = await adapter.generateManagerTurn({} as never);

    expect(out.reply).toBe("reply-1");
    expect(primary.calls.dialogue).toBe(1);
    expect(fallback.calls.dialogue).toBe(0);
  });

  it("主模型在流出任何话术前失败,改用备用并转发其增量", async () => {
    const primary = makePort({ dialogueError: new Error("HTTP 500") });
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);
    const deltas: string[] = [];

    const out = await adapter.generateManagerTurn({} as never, (d) => deltas.push(d));

    expect(out.reply).toBe("reply-1");
    expect(fallback.calls.dialogue).toBe(1);
  });

  it("主模型话术已部分流出后失败:不切换,错误向上抛", async () => {
    const primary = makePort({
      dialogueError: new Error("连接中断"),
      dialogueDeltasBeforeError: ["您"],
    });
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);
    const deltas: string[] = [];

    await expect(
      adapter.generateManagerTurn({} as never, (d) => deltas.push(d)),
    ).rejects.toThrow("连接中断");
    expect(deltas).toEqual(["您"]);
    expect(fallback.calls.dialogue).toBe(0);
  });

  it("素材分析:主模型失败改用备用", async () => {
    const primary = makePort({ analysisError: new Error("HTTP 502") });
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);

    await adapter.analyzeTranscript("转写稿");

    expect(primary.calls.analysis).toBe(1);
    expect(fallback.calls.analysis).toBe(1);
  });

  it("素材分析:主模型成功不触碰备用", async () => {
    const primary = makePort();
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);

    await adapter.analyzeTranscript("转写稿");

    expect(fallback.calls.analysis).toBe(0);
  });

  it("备用也失败时,向上抛出备用错误", async () => {
    const primary = makePort({ dialogueError: new Error("主失败") });
    const fallback = makePort({ dialogueError: new Error("备用失败") });
    const adapter = new FailoverModelAdapter([primary, fallback]);

    await expect(adapter.generateManagerTurn({} as never)).rejects.toThrow("备用失败");
  });

  it("三级链:主与第二都失败,依次切到第三", async () => {
    const first = makePort({ analysisError: new Error("一失败") });
    const second = makePort({ analysisError: new Error("二失败") });
    const third = makePort();
    const adapter = new FailoverModelAdapter([first, second, third]);

    await adapter.analyzeTranscript("转写稿");

    expect(first.calls.analysis).toBe(1);
    expect(second.calls.analysis).toBe(1);
    expect(third.calls.analysis).toBe(1);
  });

  it("整条链都失败时,抛最后一个模型的错误", async () => {
    const first = makePort({ analysisError: new Error("一失败") });
    const second = makePort({ analysisError: new Error("二失败") });
    const adapter = new FailoverModelAdapter([first, second]);

    await expect(adapter.analyzeTranscript("转写稿")).rejects.toThrow("二失败");
  });

  it("completeStream:主模型失败且无增量流出 → 切到备用", async () => {
    const primary = makePort({ streamError: new Error("HTTP 503") });
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);

    const out = await adapter.completeStream([{ role: "user", content: "你好" }]);

    expect(out).toBe("stream-1");
    expect(fallback.calls.completeStream).toBe(1);
  });

  it("completeStream:增量已流出后失败 → 不切换,错误向上抛", async () => {
    const primary = makePort({ streamError: new Error("连接中断"), streamDeltasBeforeError: ["你"] });
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);
    const deltas: string[] = [];

    await expect(
      adapter.completeStream([{ role: "user", content: "你好" }], (d) => deltas.push(d)),
    ).rejects.toThrow("连接中断");
    expect(deltas).toEqual(["你"]);
    expect(fallback.calls.completeStream).toBe(0);
  });

  it("completeStream:主模型成功时转发增量并返回正文", async () => {
    const primary = makePort();
    const fallback = makePort();
    const adapter = new FailoverModelAdapter([primary, fallback]);
    const deltas: string[] = [];

    const out = await adapter.completeStream([{ role: "user", content: "你好" }], (d) => deltas.push(d));

    expect(out).toBe("stream-1");
    expect(fallback.calls.completeStream).toBe(0);
  });

  it("空链直接拒绝构造:链上至少要有一个模型", () => {
    expect(() => new FailoverModelAdapter([])).toThrow("至少");
  });
});
