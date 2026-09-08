// AI 独立重拆(L1 复核工件,ADR 0003 决定 5;不属于产品实现)
//
// 用法(仓库根目录):
//   npx tsx .scratch/phone-coaching-agent/l1/tools/independent-analysis.ts <转写稿.md> <输出.json>
//
// - 用产品当前的分析提示词(src/adapters/prompts.ts),把转写稿喂给真实模型,
//   模型无任何仓库先验——得到的是与人工拆解相互独立的第二份分析。
// - 密钥:环境变量 MIMO_API_KEY,其次本目录 .env.local。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleAnalystSystemPrompt } from "../../../../src/adapters/prompts";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function loadKey(): string {
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  const envFile = path.join(DIR, ".env.local");
  const m = fs.readFileSync(envFile, "utf8").match(/^MIMO_API_KEY=(.+)$/m);
  if (!m) throw new Error("未找到 MIMO_API_KEY");
  return m[1].trim();
}

async function main() {
  const transcriptPath = process.argv[2] ?? "";
  const outPath = process.argv[3] ?? "";
  if (!transcriptPath || !outPath) {
    throw new Error("用法: npx tsx independent-analysis.ts <转写稿.md> <输出.json>");
  }
  const transcript = fs.readFileSync(transcriptPath, "utf8").trim();

  const response = await fetch("https://token-plan-cn.xiaomimimo.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loadKey()}`,
    },
    body: JSON.stringify({
      model: "mimo-v2.5",
      temperature: 0.2,
      max_tokens: 16384,
      messages: [
        { role: "system", content: assembleAnalystSystemPrompt() },
        { role: "user", content: `素材标题:${path.basename(transcriptPath)}\n\n转写稿:\n${transcript}` },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}:${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };
  const message = data.choices?.[0]?.message;
  const source = (message?.content ?? "").trim() || (message?.reasoning_content ?? "").trim();
  if (!source) throw new Error("模型返回为空");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, source, "utf8");
  console.log(`已写入 ${outPath}(${source.length} 字)`);
}

main().catch((e) => {
  console.error("独立拆解失败:", (e as Error).message);
  process.exit(1);
});
