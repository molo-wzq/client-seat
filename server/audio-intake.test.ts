import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestAudio } from "./audio-intake";
import type { AudioTranscriber } from "./audio-transcriber";
import type { SpeakerDiarizer } from "./audio-transcriber";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phone-coach-audio-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("后台录音摄入任务", () => {
  it("原子写出待校对稿,不复制原录音", async () => {
    const directory = temporaryDirectory();
    const audioPath = path.join(directory, "优秀案例.mp3");
    const outputPath = path.join(directory, "out", "draft.md");
    fs.writeFileSync(audioPath, Buffer.from([1, 2, 3]));
    const transcriber: AudioTranscriber = {
      transcribe: async () => "您好。您说。",
    };
    const diarizer: SpeakerDiarizer = { diarize: async () => "T01 经理:您好。\nT02 客户:您说。" };

    const result = await ingestAudio({
      audioPath,
      outputPath,
      transcriber,
      diarizer,
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    expect(result).toBe(outputPath);
    expect(fs.readFileSync(outputPath, "utf8")).toContain("状态:待人工校对与脱敏");
    expect(fs.readFileSync(outputPath, "utf8")).toContain("T02 客户:您说。");
    expect(fs.readdirSync(path.dirname(outputPath))).toEqual(["draft.md"]);
  });

  it("转写失败时不产生半成品", async () => {
    const directory = temporaryDirectory();
    const audioPath = path.join(directory, "call.wav");
    const outputPath = path.join(directory, "draft.md");
    fs.writeFileSync(audioPath, Buffer.from([1]));
    const transcriber: AudioTranscriber = {
      transcribe: async () => {
        throw new Error("service down");
      },
    };
    const diarizer: SpeakerDiarizer = { diarize: async (transcript) => transcript };

    await expect(ingestAudio({ audioPath, outputPath, transcriber, diarizer })).rejects.toThrow("service down");
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("说话人区分失败时不产生半成品", async () => {
    const directory = temporaryDirectory();
    const audioPath = path.join(directory, "call.mp3");
    const outputPath = path.join(directory, "draft.md");
    fs.writeFileSync(audioPath, Buffer.from([1]));
    const transcriber: AudioTranscriber = { transcribe: async () => "您好。您说。" };
    const diarizer: SpeakerDiarizer = {
      diarize: async () => {
        throw new Error("diarization failed");
      },
    };

    await expect(ingestAudio({ audioPath, outputPath, transcriber, diarizer })).rejects.toThrow("diarization failed");
    expect(fs.existsSync(outputPath)).toBe(false);
  });
});
