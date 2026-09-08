// 一次性素材转写脚本(L1 素材准备,不属于产品实现)
//
// 用法:
//   node transcribe.mjs <音频文件> <输出文件.md> [--diarize]
//
// - 模型:mimo-v2.5-asr,经 https://token-plan-cn.xiaomimimo.com/v1/chat/completions
// - 密钥:优先环境变量 MIMO_API_KEY,其次本目录 .env.local(一行 MIMO_API_KEY=xxx)
// - 输出写入调用方指定的路径。约定:原始转写只允许写入
//   ../transcripts/_unscreened/(暂存),脱敏复核后才可移入 transcripts/ 成为持久产物。
// - --diarize 会在音频前附一条文本指令,要求模型按"经理:/客户:"区分说话人;
//   效果不确定,与不带该参数的结果对比后择优。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [audioPath, outPath, ...flags] = process.argv.slice(2);
if (!audioPath || !outPath) {
  console.error('用法: node transcribe.mjs <音频文件> <输出文件.md> [--diarize]');
  process.exit(1);
}

const BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
const MODEL = 'mimo-v2.5-asr';

function loadKey() {
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^MIMO_API_KEY=(.+)$/);
      if (m) return m[1].trim();
    }
  }
  console.error('未找到 MIMO_API_KEY(环境变量或 tools/.env.local)');
  process.exit(1);
}

const key = loadKey();
const audio = fs.readFileSync(audioPath);
const b64 = audio.toString('base64');
const ext = path.extname(audioPath).slice(1).toLowerCase() || 'mp3';

const diarize = flags.includes('--diarize');
const DIARIZE_PROMPT =
  '将这段中文电话录音转写为文字。录音中有两位说话人:银行理财经理和客户。' +
  '请逐句区分说话人,理财经理的行以"经理:"开头,客户的行以"客户:"开头,按对话实际顺序输出。' +
  '只输出转写内容,不要添加录音中不存在的信息,不要总结。';

const parts = [{ type: 'input_audio', input_audio: { data: b64, format: ext } }];
if (diarize) parts.push({ type: 'text', text: DIARIZE_PROMPT });

const res = await fetch(`${BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: parts }] }),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error((await res.text()).slice(0, 2000));
  process.exit(1);
}

const data = await res.json();
const content = data.choices?.[0]?.message?.content;
if (!content) {
  console.error('响应中无转写内容:', JSON.stringify(data).slice(0, 1000));
  process.exit(1);
}

const header = [
  `> 转写来源:${path.basename(audioPath)}`,
  `> 模型:${MODEL}${diarize ? '(含说话人区分指令)' : ''}`,
  `> 转写时间:${new Date().toISOString()}`,
  `> 状态:未脱敏暂存,复核脱敏后方可移入 transcripts/`,
  '',
].join('\n');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header + content + '\n', 'utf8');

const usage = data.usage ? `usage: ${JSON.stringify(data.usage)}` : 'usage: 无';
console.log(`已写入 ${outPath}(${content.length} 字)`);
console.log(`finish_reason: ${data.choices?.[0]?.finish_reason}; ${usage}`);
