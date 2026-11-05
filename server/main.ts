import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAICompatibleModelAdapter } from "../src/adapters/openai-model-adapter";
import { FakeModelAdapter } from "../src/adapters/fake-model-adapter";
import { FailoverModelAdapter } from "../src/adapters/failover-model-adapter";
import type { CopywritingPort, DialoguePort } from "../src/domain/ports";
import { createProductCore } from "../src/domain/product-core";
import { purgeExpiredConversations } from "../src/domain/conversation-retention";
import { createRequestListener } from "./app-server";
import { createAgentCore } from "./agent/core";
import { createModelWorkers } from "./agent/workers";
import { createWatchdog } from "./agent/watchdog";
import { loadCurrentResearchReport } from "./report-parser";
import { loadEnvFile, readConversationRetention } from "./env";
import { FileStorage } from "./file-store";
import {
  formatRegistrySummary,
  readModelsConfigFile,
  resolveModelRegistry,
  type ResolvedModelRegistry,
  type RoleModelEntry,
} from "./model-registry";

/** 组合根:读配置 → 建核心 → 起服务;路由与错误映射在 app-server.ts。 */

loadEnvFile();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5175);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`[phone-coach] PORT 配置不合法:${process.env.PORT}(需要 0–65535 的整数)`);
  process.exit(1);
}
// 托管平台容器里要绑 0.0.0.0 才能被外部访问;本地默认仍只监听回环。
const HOST = process.env.HOST || "127.0.0.1";
const DATA_FILE = path.join(ROOT, "data", "db.json");

// 对话存储上限(最大存储时间/条数):非法值直接终止启动,不带病运行。
let retention;
try {
  retention = readConversationRetention(process.env);
} catch (error) {
  console.error(`[phone-coach] ${(error as Error).message}`);
  process.exit(1);
}

// 模型注册表(工单 13):models.config.json(可选)+ 旧环境变量 → 按角色的 fallback 链。
// 配置不合法(能力不匹配、引用未登记 provider、anthropic-messages 未实现)直接终止启动。
let registry: ResolvedModelRegistry;
try {
  registry = resolveModelRegistry({ config: readModelsConfigFile(ROOT), env: process.env });
} catch (error) {
  console.error(`[phone-coach] 模型注册表配置不合法:${(error as Error).message}`);
  process.exit(1);
}
// 启动摘要:逐角色打印实际 provider:model(含 fallback 链),绝不打印密钥。
for (const line of formatRegistrySummary(registry).split("\n")) {
  console.log(`[phone-coach] 模型 ${line}`);
}

// 按角色组装适配器:链上每个模型一个 OpenAI 兼容适配器,交给 FailoverModelAdapter
// 依次切换(工单 13);judge 只在显式配置时注入链首模型,未配置时不注入——
// 链上各项自裁,裁判跟着本次实际出话的模型走,主模型挂掉不会再请求它(S6)。
const buildModel = (entry: RoleModelEntry): OpenAICompatibleModelAdapter =>
  new OpenAICompatibleModelAdapter({ apiKey: entry.apiKey!, baseUrl: entry.baseUrl, model: entry.model });
const buildChain = (entries: RoleModelEntry[], judge?: OpenAICompatibleModelAdapter): FailoverModelAdapter =>
  new FailoverModelAdapter(
    entries.map(
      (entry) =>
        new OpenAICompatibleModelAdapter({ apiKey: entry.apiKey!, baseUrl: entry.baseUrl, model: entry.model }, judge),
    ),
  );

const judgeEntry = registry.roles.judge[0];
const judge = judgeEntry ? buildModel(judgeEntry) : undefined;
const dialogue: DialoguePort =
  registry.roles.manager.length > 0 ? buildChain(registry.roles.manager, judge) : new FakeModelAdapter();
const copywriting: CopywritingPort =
  registry.roles.copywriting.length > 0 ? buildChain(registry.roles.copywriting) : new FakeModelAdapter();
if (registry.roles.manager.length === 0 && registry.roles.copywriting.length === 0) {
  console.warn(
    "[phone-coach] 未配置任何对话模型密钥,语言模型使用内置伪实现(仅演示);配置见 README.md",
  );
}
const onlyFallback = registry.roles.manager;
if (onlyFallback.length === 1 && onlyFallback[0].providerId === "llm-fallback") {
  console.warn("[phone-coach] 只配置了 LLM_FALLBACK_*,未配置主模型,备用将作为唯一模型使用");
}

const storage = new FileStorage(DATA_FILE);
const core = createProductCore({
  copywriting,
  dialogue,
  storage,
  retention,
});

// 桌宠 Agent(ADR 0007,工单 11→13):账本与产品数据同库。
// 对话走 agent.chat 链(轻量),投研/盲区草稿走 agent.worker 链(强模型),
// 都由注册表解析(旧变量映射或 models.config.json);链为空即无 key,Worker 退回 demo,演示完整可用。
// 只读工具数据源(工单 16):全部本地数据(投研 JSON/素材库/历史对局),不接外网。
const chatChain = registry.roles["agent.chat"];
const draftChain = registry.roles["agent.worker"];
const agent = createAgentCore({
  storage,
  worker: createModelWorkers({
    routerModel: chatChain.length > 0 ? buildChain(chatChain) : undefined,
    workerModel: draftChain.length > 0 ? buildChain(draftChain) : undefined,
    toolSources: {
      weeklyResearch: async () => {
        const report = loadCurrentResearchReport(ROOT);
        const risk = report.sections.risk;
        return [
          `${report.title}(${report.period})`,
          `宏观:${report.sections.macro.headline}`,
          `行业:${report.sections.sector.summary}`,
          risk.objections[0] ? `高频异议:${risk.objections[0].question}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
      searchCards: async (keyword) => {
        const query = keyword.trim();
        if (!query) return "请给一个关键词。";
        const hits = (await core.listMaterials())
          .flatMap((material) => material.cards.filter((card) => card.status === "published").map((card) => ({ card, material })))
          .filter(({ card }) =>
            [card.name, ...card.triggerSignals, ...card.referenceScripts].some((text) => text.includes(query)),
          )
          .slice(0, 5);
        if (hits.length === 0) return `没有找到与「${query}」相关的已发布策略卡。`;
        return hits
          .map(({ card, material }) => `${card.name}:目的「${card.currentPurpose}」;出处:${material.title} ${card.sourceExcerpt.turnRange}`)
          .join("\n");
      },
      lastReview: async () => {
        const ended = (await core.listConversations()).find((item) => item.status === "ended");
        if (!ended) return "还没有打过一局。";
        return `上一局结局:${ended.outcomeSummary ?? "未知"};收口原因:${ended.endReason ?? "未知"}。`;
      },
    },
  }),
});
if (chatChain.length === 0 && draftChain.length === 0) {
  console.warn("[phone-coach] 桌宠 Agent 未配置任何模型角色(AGENT_*/MIMO_*/models.config.json),对话与草稿走 demo 演示");
}

// Watchdog(工单 09):工单超时没进展先重试一次,再卡住就标受阻进待办,不发桌宠气泡。
// 阈值默认 10 分钟;演示可用 WATCHDOG_THRESHOLD_MS 调短,配置不合法回落默认。
const watchdogThresholdMs = Number(process.env.WATCHDOG_THRESHOLD_MS);
createWatchdog({
  agent,
  thresholdMs: Number.isFinite(watchdogThresholdMs) && watchdogThresholdMs > 0 ? watchdogThresholdMs : undefined,
}).start();

// 启动即按保留策略清一次:不开新对话也能回收旧数据。
const purgedIds = await purgeExpiredConversations(storage, new Date(), retention);
if (purgedIds.length > 0) {
  console.log(`[phone-coach] 已按存储上限清理 ${purgedIds.length} 通过期对话(上限:${retention.maxCount ?? "不限"} 通 / ${retention.maxAgeMs !== null ? `${retention.maxAgeMs / 86400000} 天` : "不限"})`);
}

const server = http.createServer(
  createRequestListener({ core, staticRoot: path.join(ROOT, "dist"), agent }),
);
server.listen(PORT, HOST, () => {
  console.log(`[phone-coach] API 服务已启动:http://${HOST}:${PORT}(数据文件:${DATA_FILE})`);
});
