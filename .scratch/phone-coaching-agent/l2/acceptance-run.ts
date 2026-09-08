// 产品验收演示(L3 票 01-05,ready-for-human 验收;不属于产品实现)
//
// 用法(仓库根目录):
//   npx tsx .scratch/phone-coaching-agent/l2/acceptance-run.ts
//
// - 全部走产品真实代码(createProductCore + InMemoryStorage)与真实模型:
//   分析口与对话口都用 OpenAICompatibleModelAdapter(与 server/main.ts 同配置)。
// - 密钥:环境变量 MIMO_API_KEY,其次 l1/tools/.env.local。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAICompatibleModelAdapter } from "../../../src/adapters/openai-model-adapter";
import { createProductCore } from "../../../src/domain/product-core";
import { InMemoryStorage } from "../../../src/product/in-process-product-api";
import { SEED_TRANSCRIPT } from "../../../src/domain/seed";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function loadKey(): string {
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  const envFile = path.join(DIR, "..", "l1", "tools", ".env.local");
  const m = fs.readFileSync(envFile, "utf8").match(/^MIMO_API_KEY=(.+)$/m);
  if (!m) throw new Error("未找到 MIMO_API_KEY");
  return m[1].trim();
}

async function main() {
  const adapter = new OpenAICompatibleModelAdapter({
    apiKey: loadKey(),
    baseUrl: process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1",
    model: process.env.MIMO_MODEL || "mimo-v2.5",
  });
  const core = createProductCore({ copywriting: adapter, dialogue: adapter, storage: new InMemoryStorage() });

  console.log("== 验收 1:分析口(真实模型拆种子转写稿)==");
  const t0 = Date.now();
  const material = await core.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
  console.log(`素材:${material.id} 标题:${material.title}`);
  console.log(`轮次:${material.turns.length} 句(说话人区分),场景:${material.analysis.scenario.slice(0, 60)}…`);
  console.log(`阶段:${material.analysis.stages.map((s) => s.name).join(" | ")}`);
  console.log(`卡数:${material.cards.length}(草稿)`, material.cards.map((c) => `${c.id} ${c.name.slice(0, 16)}`).join(";"));
  console.log(`耗时:${Math.round((Date.now() - t0) / 1000)}s`);

  console.log("\n== 验收 2:发布 ==");
  const published = await core.publishMaterialCards(material.id);
  console.log(`状态:${published.cards.map((c) => c.status).join(",")}`);

  console.log("\n== 验收 3:画像列表(内置 3 个)==");
  const personas = await core.listPersonas();
  console.log(personas.map((p) => `${p.id} ${p.name}(可见${p.visible.length}条/隐藏${p.hidden.length}条)`).join("\n"));

  console.log("\n== 验收 4:对话(内置 P03 定期到期话少客户,真实模型)==");
  const conversation = await core.startConversation("p03-dingqi-huashao");
  const customerScript = ["喂。", "啊,是我,哪笔定期?", "哦,周六到期啊……我用不到,续着吧。", "嗯。", "我那边银行还有笔钱,大概一月中旬到期。", "一月十五号左右吧,到时候你再打给我。"];
  for (const line of customerScript) {
    const after = await core.sendCustomerTurn(conversation.id, line);
    const manager = after.turns.at(-1)!;
    console.log(`客户:${line}`);
    console.log(`经理:${manager.text.slice(0, 90)}${manager.text.length > 90 ? "…" : ""}${manager.usedCardId ? ` [卡:${manager.usedCardId}]` : ""}`);
    if (after.status === "ended") {
      console.log(`→ 通话结束:${after.endReason}`);
      break;
    }
  }
  await core.finishConversation(conversation.id);

  console.log("\n== 验收 5:结果与追溯 ==");
  const result = await core.getResult(conversation.id);
  console.log(`主要目标:${result.mainGoal.slice(0, 90)}…`);
  console.log(`沟通结果:${result.outcome.slice(0, 90)}…`);
  console.log(`结束原因:${result.endReason}`);
  console.log("策略路径:");
  for (const entry of result.strategyPath) {
    const sourceTurns = entry.sourceTurns.map((t) => `T${t.number} ${t.speaker === "manager" ? "经理" : "客户"}:${t.text.slice(0, 30)}…`).join("\n    ");
    console.log(`- 第${entry.turnNumber}轮 ${entry.cardName}`);
    console.log(`  来源:${entry.source?.materialTitle} ${entry.source?.turnRange}`);
    if (sourceTurns) console.log(`  原始片段:\n    ${sourceTurns}`);
  }
  console.log("\n验收演示完成。");
}

main().catch((e) => {
  console.error("验收演示失败:", (e as Error).message);
  process.exit(1);
});
