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
import { loadEnvFile, readConversationRetention } from "./env";
import { FileStorage } from "./file-store";
import { readLlmConfig, readLlmFallbackConfig } from "./model-config";

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

// 对话/文案分析共用 LLM 配置;转写走独立 CLI(server/audio-intake.ts),不在此组合根。
// 主备双供应商:主网关失败且话术未流出时由 FailoverModelAdapter 自动切到备用。
const llm = readLlmConfig(process.env);
const llmFallback = readLlmFallbackConfig(process.env);
const adapter: CopywritingPort & DialoguePort = (() => {
  const build = (cfg: typeof llm): OpenAICompatibleModelAdapter =>
    new OpenAICompatibleModelAdapter({ apiKey: cfg.apiKey!, baseUrl: cfg.baseUrl, model: cfg.model });
  if (llm.apiKey && llmFallback.apiKey) {
    console.log(
      `[phone-coach] LLM 双供应商:主 ${llm.model}(${llm.baseUrl}) → 备 ${llmFallback.model}(${llmFallback.baseUrl})`,
    );
    return new FailoverModelAdapter(build(llm), build(llmFallback));
  }
  if (llm.apiKey) return build(llm);
  if (llmFallback.apiKey) {
    console.warn("[phone-coach] 只配置了 LLM_FALLBACK_*,未配置主模型,备用将作为唯一模型使用");
    return build(llmFallback);
  }
  return new FakeModelAdapter();
})();
if (!llm.apiKey && !llmFallback.apiKey) {
  console.warn(
    "[phone-coach] 未配置 MIMO_API_KEY,语言模型使用内置伪实现(仅演示);配置见 README.md",
  );
}

const storage = new FileStorage(DATA_FILE);
const core = createProductCore({
  copywriting: adapter,
  dialogue: adapter,
  storage,
  retention,
});

// 启动即按保留策略清一次:不开新对话也能回收旧数据。
const purgedIds = await purgeExpiredConversations(storage, new Date(), retention);
if (purgedIds.length > 0) {
  console.log(`[phone-coach] 已按存储上限清理 ${purgedIds.length} 通过期对话(上限:${retention.maxCount ?? "不限"} 通 / ${retention.maxAgeMs !== null ? `${retention.maxAgeMs / 86400000} 天` : "不限"})`);
}

const server = http.createServer(createRequestListener({ core, staticRoot: path.join(ROOT, "dist") }));
server.listen(PORT, HOST, () => {
  console.log(`[phone-coach] API 服务已启动:http://${HOST}:${PORT}(数据文件:${DATA_FILE})`);
});
