import { describe, expect, it } from "vitest";
import { FailoverModelAdapter } from "./failover-model-adapter";
import type { CopywritingPort, DialoguePort, TranscriptAnalysis } from "../domain/ports";

/** 可编程的端口替身:按脚本抛错/返回,并记录调用与流式增量。 */
function makePort(overrides?: {
  dialogueError?: Error;
  dialogueDeltasBeforeError?: string[];
  analysisError?: Error;
}) {
  const calls = { dialogue: 0, analysis: 0 };
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
  return { ...dialogue, ...copywriting, calls };
}

describe("FailoverModelAdapter", () => {
  it("主模型对话成功时不触碰备用", async () => {
    const primary = makePort();
    const fallback = makePort();
    const adapter = new FailoverModelAdapter(primary, fallback);

    const out = await adapter.generateManagerTurn({} as never);

    expect(out.reply).toBe("reply-1");
    expect(primary.calls.dialogue).toBe(1);
    expect(fallback.calls.dialogue).toBe(0);
  });

  it("主模型在流出任何话术前失败,改用备用并转发其增量", async () => {
    const primary = makePort({ dialogueError: new Error("HTTP 500") });
    const fallback = makePort();
    const adapter = new FailoverModelAdapter(primary, fallback);
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
    const adapter = new FailoverModelAdapter(primary, fallback);
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
    const adapter = new FailoverModelAdapter(primary, fallback);

    await adapter.analyzeTranscript("转写稿");

    expect(primary.calls.analysis).toBe(1);
    expect(fallback.calls.analysis).toBe(1);
  });

  it("素材分析:主模型成功不触碰备用", async () => {
    const primary = makePort();
    const fallback = makePort();
    const adapter = new FailoverModelAdapter(primary, fallback);

    await adapter.analyzeTranscript("转写稿");

    expect(fallback.calls.analysis).toBe(0);
  });

  it("备用也失败时,向上抛出备用错误", async () => {
    const primary = makePort({ dialogueError: new Error("主失败") });
    const fallback = makePort({ dialogueError: new Error("备用失败") });
    const adapter = new FailoverModelAdapter(primary, fallback);

    await expect(adapter.generateManagerTurn({} as never)).rejects.toThrow("备用失败");
  });
});
