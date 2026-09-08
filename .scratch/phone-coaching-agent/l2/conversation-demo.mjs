// 最小对话 demo(L2 验证工件,不属于产品实现)
//
// 用法:
//   node conversation-demo.mjs --scripted <客户轮次.txt> --out <输出.md>
//   node conversation-demo.mjs                     (交互模式,键盘输入扮演客户)
//
// - 理财经理由 mimo-v2.5 扮演,system 提示词取自同目录 manager-prompt.md
// - scripted 模式按文件逐行扮演客户(# 开头为注释,空行跳过),文件用尽即结束
// - 对话结束后追加一次"策略路径解释"调用,把对话映射回策略卡
// - 密钥:环境变量 MIMO_API_KEY 或 ../tools/.env.local

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadKey() {
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  const envFile = path.join(DIR, '..', 'l1', 'tools', '.env.local');
  const m = fs.readFileSync(envFile, 'utf8').match(/^MIMO_API_KEY=(.+)$/m);
  if (m) return m[1].trim();
  console.error('未找到 MIMO_API_KEY');
  process.exit(1);
}

const BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
const MODEL = 'mimo-v2.5';
const MAX_ROUNDS = 12;

const systemPrompt = fs.readFileSync(path.join(DIR, 'manager-prompt.md'), 'utf8');
const scriptedFile = arg('--scripted');
const outFile = arg('--out') ?? 'demo-conversation-01.md';

const turns = []; // {role: '客户'|'经理', text}

async function managerReply() {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...turns.map(t => ({ role: t.role === '客户' ? 'user' : 'assistant', content: t.text })),
  ];
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loadKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, (await res.text()).slice(0, 500));
    process.exit(1);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function explain() {
  const transcript = turns.map(t => `${t.role}:${t.text}`).join('\n');
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loadKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            '你是电话复盘助手。根据给定的模拟通话记录和策略卡,输出复盘,不评价客户表现、不打分。' +
            '严格按以下小节输出 markdown:\n' +
            '## 主要目标\n## 沟通结果与结束原因\n## 策略路径(实际用了哪张策略卡的哪些动作,按轮次说明)\n## 关键表达(挑2-3处,说明对应策略卡)\n' +
            '策略卡共三张:SC1 生客开场自报身份给退路;SC2 只问现状贴着回答找资金切入点;SC3 默认选项预约、异议即解释、落到加微信。' +
            '只依据对话记录,不要编造没发生的动作。',
        },
        { role: 'user', content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, (await res.text()).slice(0, 500));
    process.exit(1);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// --- 主流程 ---
const scriptLines = scriptedFile
  ? fs
      .readFileSync(path.isAbsolute(scriptedFile) ? scriptedFile : path.join(DIR, scriptedFile), 'utf8')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  : null;

let idx = 0;
const rl = scriptLines ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => (rl ? new Promise(r => rl.question(q, r)) : Promise.resolve(scriptLines[idx++]));

console.log('=== 最小对话 demo:输入"喂"开始,客户轮由' + (scriptLines ? '脚本扮演' : '键盘输入') + ' ===\n');

let round = 0;
while (round < MAX_ROUNDS * 2 + 4) {
  const customer = (await ask('客户> ')) ?? '';
  if (!customer.trim()) break;
  turns.push({ role: '客户', text: customer.trim() });
  console.log(`客户: ${customer.trim()}\n`);
  if (scriptLines && idx >= scriptLines.length) {
    // 最后一轮客户说完,让经理收口后结束
    const reply = await managerReply();
    turns.push({ role: '经理', text: reply });
    console.log(`经理: ${reply}\n`);
    break;
  }
  const reply = await managerReply();
  turns.push({ role: '经理', text: reply });
  console.log(`经理: ${reply}\n`);
  round++;
}
rl?.close();

console.log('--- 通话结束,生成策略路径解释 ---\n');
const explanation = await explain();

const header = [
  `# Demo 对话记录:P01 画像 × C01 策略卡`,
  '',
  `- 日期:${new Date().toISOString()}`,
  `- 模型:${MODEL}(理财经理);客户由${scriptLines ? '脚本轮次' : '键盘输入'}扮演`,
  `- 提示词:manager-prompt.md(含可见画像、SC1–SC3、虚拟产品卡)`,
  `- 轮数:经理 ${turns.filter(t => t.role === '经理').length} 轮`,
  '',
  '## 对话记录',
  '',
  ...turns.map(t => `- **${t.role}**:${t.text}`),
  '',
  '## 策略路径解释(AI 复盘)',
  '',
  explanation,
  '',
].join('\n');

fs.writeFileSync(path.isAbsolute(outFile) ? outFile : path.join(DIR, outFile), header, 'utf8');
console.log(`已写入 ${outFile}`);
