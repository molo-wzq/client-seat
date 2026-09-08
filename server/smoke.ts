/** 一次性冒烟脚本:对运行中的 API 服务跑一遍真实模型全流程。 */
import { SEED_TRANSCRIPT } from "../src/domain/seed";

const BASE = "http://127.0.0.1:5175/api";

async function call(path: string, payload?: unknown, method?: string): Promise<any> {
  const res = await fetch(BASE + path, {
    method: method || (payload ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

console.log("== 1. 分析转写稿(真实模型) ==");
const material = await call("/materials/analyze", { transcript: SEED_TRANSCRIPT });
console.log(`素材 ${material.id},卡数:${material.cards.length}`);
for (const card of material.cards) console.log(` - [${card.status}] ${card.id} ${card.name} (${card.sourceExcerpt?.turnRange})`);

console.log("== 2. 发布策略卡 ==");
const published = await call(`/materials/${material.id}/publish`, {});
console.log(`发布后状态:${published.cards.map((c: any) => c.status).join(",")}`);

console.log("== 3. 开始通话并发送「喂」 ==");
const conversation = await call("/conversations", { personaId: "p01-daifagua" });
let current = await call(`/conversations/${conversation.id}/turns`, { text: "喂" });
const last = current.turns[current.turns.length - 1];
console.log(`经理回复:${last.text}`);
console.log(`引用卡:${last.usedCardId} | 目标:${last.currentGoal} | 信号:${last.recognizedSignal}`);

console.log("== 4. 再走两轮(现状提问→收尾) ==");
current = await call(`/conversations/${conversation.id}/turns`, { text: "没做过,我钱都在证券里炒股,平时搞国债逆回购,T+1。" });
console.log(`经理回复:${current.turns[current.turns.length - 1].text}`);
current = await call(`/conversations/${conversation.id}/turns`, { text: "行,那先报上吧,顺便加个微信。" });
const lastTurn = current.turns[current.turns.length - 1];
console.log(`经理回复:${lastTurn.text}`);
console.log(`通话状态:${current.status},结束原因:${current.endReason ?? "(未结束)"}`);

if (current.status !== "ended") {
  console.log("== 5. 客户主动结束 ==");
  current = await call(`/conversations/${conversation.id}/finish`, {});
  console.log(`通话状态:${current.status},结束原因:${current.endReason}`);
}

console.log("== 6. 结果追溯 ==");
const result = await call(`/conversations/${conversation.id}/result`);
console.log(`主要目标:${result.mainGoal}`);
console.log(`沟通结果:${result.outcome}`);
console.log(`结束原因:${result.endReason}`);
console.log("策略路径:");
for (const entry of result.strategyPath) {
  console.log(` - 第${entry.turnNumber}轮 ${entry.cardName} | 来源:${entry.source ? `${entry.source.materialTitle} ${entry.source.turnRange}` : "无"}`);
  console.log(`   关键表达:${entry.keyExpression.slice(0, 60)}...`);
}
console.log("SMOKE OK");
