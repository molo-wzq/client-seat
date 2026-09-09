import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_MODEL_BASE_URL } from "../src/adapters/openai-model-adapter";
import { loadEnvFile } from "./env";
import {
  DEFAULT_ASR_MODEL,
  MAX_AUDIO_BYTES,
  MimoAudioTranscriber,
  parseAudioFormat,
  type AudioTranscriber,
} from "./audio-transcriber";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function ingestAudio(input: {
  audioPath: string;
  outputPath?: string;
  transcriber: AudioTranscriber;
  now?: Date;
}): Promise<string> {
  const audioPath = path.resolve(input.audioPath);
  if (!fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile()) {
    throw new Error(`录音文件不存在:${audioPath}`);
  }
  const format = parseAudioFormat(audioPath);
  const bytes = fs.readFileSync(audioPath);
  if (bytes.length === 0) throw new Error("录音文件为空");
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("录音文件不能超过 25MB");

  const transcript = (await input.transcriber.transcribe({ bytes, format })).trim();
  if (!transcript) throw new Error("转写服务未返回文字");

  const now = input.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const stem = path.basename(audioPath, path.extname(audioPath)).replace(/[^\p{L}\p{N}._-]+/gu, "-") || "audio";
  const outputPath = path.resolve(
    input.outputPath ?? path.join(ROOT, "data", "audio-intake", `${stem}-${stamp}.md`),
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const content = [
    `# 待校对录音转写:${stem}`,
    "",
    `- 来源文件:${path.basename(audioPath)}`,
    `- 转写时间:${now.toISOString()}`,
    "- 状态:待人工校对与脱敏;确认前不要导入素材库",
    "",
    transcript,
    "",
  ].join("\n");
  try {
    fs.writeFileSync(temporaryPath, content, "utf8");
    fs.renameSync(temporaryPath, outputPath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
  return outputPath;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnvFile();
  const args = process.argv.slice(2);
  const audioPath = args[0];
  if (!audioPath || audioPath.startsWith("--")) {
    console.error("用法:npm run audio:ingest -- <录音文件> [--out <待校对稿.md>]");
    process.exitCode = 1;
    return;
  }
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) throw new Error("缺少 MIMO_API_KEY,无法执行后台录音转写");

  console.log(`开始后台转写:${path.basename(audioPath)}(耗时可能为数分钟)`);
  const outputPath = await ingestAudio({
    audioPath,
    outputPath: optionValue(args, "--out"),
    transcriber: new MimoAudioTranscriber({
      apiKey,
      baseUrl: process.env.MIMO_BASE_URL || DEFAULT_MODEL_BASE_URL,
      model: process.env.MIMO_ASR_MODEL || DEFAULT_ASR_MODEL,
    }),
  });
  console.log(`转写完成:${outputPath}`);
  console.log("下一步:人工校对并脱敏,再把文字交给素材库分析。原录音不会进入产品数据。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
