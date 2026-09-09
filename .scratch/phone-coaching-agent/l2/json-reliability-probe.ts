/**
 * 票 12 探测与采样工具(手动运行,不进测试套件):
 *   npx tsx .scratch/phone-coaching-agent/l2/json-reliability-probe.ts probe
 *   npx tsx .scratch/phone-coaching-agent/l2/json-reliability-probe.ts sample "<条件说明>" [输出文件名]
 *
 * probe  探测网关是否支持 response_format=json_object;
 * sample 用当前适配器跑 3 画像 × 4 场景 = 12 轮采样并写结果 JSON。
 *        采样条件由调用者用 <条件说明> 标注:适配器发不发 response_format
 *        取决于当时的代码状态(票 12 的 before 基线即靠临时 stash 采样)。
 *
 * 降级判定为宽口径:规则 10 要求 signal/goal 每轮必填,经理轮输出缺任一
 * 元数据即计入;票面所述「纯文本降级」是其主要成因(真子集)。
 */
import { loadEnvFile } from "../../../server/env";
import {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_NAME,
  OpenAICompatibleModelAdapter,
} from "../../../src/adapters/openai-model-adapter";
import {
  SEED_CARDS,
  SEED_PERSONA,
  SEED_PERSONA_P02,
  SEED_PERSONA_P03,
  SEED_PRODUCT_CARD,
} from "../../../src/domain/seed";
import type { ConversationTurn } from "../../../src/domain/types";

loadEnvFile();

const apiKey = process.env.MIMO_API_KEY;
if (!apiKey) throw new Error("缺少 MIMO_API_KEY");
const base = process.env.MIMO_BASE_URL || DEFAULT_MODEL_BASE_URL;
const model = process.env.MIMO_MODEL || DEFAULT_MODEL_NAME;

const PERSONAS = [
  { key: "P01", visible: SEED_PERSONA.visible },
  { key: "P02", visible: SEED_PERSONA_P02.visible },
  { key: "P03", visible: SEED_PERSONA_P03.visible },
];

const OPENING_HISTORY: ConversationTurn[] = [
  { number: 1, speaker: "customer", text: "喂,哪位?" },
  {
    number: 2,
    speaker: "manager",
    text: "您好,我是咱们银行的客户经理。您现在方便简单聊两句吗?行里最近有个客户资金活动,想跟您说一下,不耽误您太久。",
  },
];

const SCENARIOS = [
  { key: "开场", history: [] as ConversationTurn[], customerText: "喂" },
  { key: "软拒绝", history: OPENING_HISTORY, customerText: "再说吧,暂时不用。" },
  {
    key: "资金话题",
    history: OPENING_HISTORY,
    customerText: "我平时的钱都放在证券里,做国债逆回购。",
  },
  { key: "明确拒绝", history: OPENING_HISTORY, customerText: "不需要,你不用再打过来了。" },
];

function adapter(): OpenAICompatibleModelAdapter {
  return new OpenAICompatibleModelAdapter({ apiKey: apiKey as string, baseUrl: base, model });
}

async function probeJsonMode(): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    const started = Date.now();
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: '只输出一个 JSON 对象,形如 {"ok": true, "note": "一句话"}。' },
          { role: "user", content: "开始。" },
        ],
        temperature: 0.7,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    const body = await response.text().catch(() => "");
    let parseOk = false;
    let content = "";
    if (response.ok) {
      try {
        const data = JSON.parse(body) as {
          choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
        };
        content = data.choices?.[0]?.message?.content ?? "";
        parseOk = content.trim().startsWith("{");
      } catch {
        parseOk = false;
      }
    }
    console.log(
      `[probe ${i}] HTTP ${response.status} parseOk=${parseOk} ${Date.now() - started}ms content=${content.slice(0, 120) || body.slice(0, 160)}`,
    );
  }
}

type Row = { persona: string; scenario: string; degraded: boolean; usedCardId?: string; replyHead: string; ms: number };

async function sample(note: string, outName = "json-reliability-sample.json"): Promise<void> {
  const rows: Row[] = [];
  const cap = adapter();
  console.log(`[sample] 条件:${note}`);
  for (const persona of PERSONAS) {
    for (const scenario of SCENARIOS) {
      const started = Date.now();
      const output = await cap.generateManagerTurn({
        persona: { id: persona.key, name: persona.key, visible: persona.visible },
        publishedCards: SEED_CARDS,
        product: SEED_PRODUCT_CARD,
        history: scenario.history,
        customerText: scenario.customerText,
      });
      const degraded = !output.recognizedSignal || !output.currentGoal;
      rows.push({
        persona: persona.key,
        scenario: scenario.key,
        degraded,
        usedCardId: output.usedCardId,
        replyHead: output.reply.slice(0, 42),
        ms: Date.now() - started,
      });
      console.log(
        `[round] ${persona.key}/${scenario.key} degraded=${degraded} card=${output.usedCardId ?? "-"} | ${output.reply.slice(0, 36)}`,
      );
    }
  }
  const degradedCount = rows.filter((r) => r.degraded).length;
  const summary = `共 ${rows.length} 轮,降级 ${degradedCount} 轮(降级率 ${(degradedCount / rows.length * 100).toFixed(1)}%)`;
  console.log(`\n[summary] ${summary}`);
  const record = {
    date: new Date().toISOString().slice(0, 10),
    note,
    model,
    baseUrl: base,
    rounds: rows.length,
    degraded: degradedCount,
    degradedRate: Number((degradedCount / rows.length).toFixed(3)),
    rows,
  };
  const outFile = new URL(`./${outName}`, import.meta.url);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outFile, JSON.stringify(record, null, 2), "utf8");
  console.log(`[written] ${outFile.pathname}`);
}

const mode = process.argv[2] ?? "probe";
const note = process.argv[3] ?? "";
if (mode === "probe") await probeJsonMode();
else if (mode === "sample") await sample(note || "未标注条件的抽样", process.argv[4]);
else throw new Error(`未知模式:${mode}`);
