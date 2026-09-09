import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAICompatibleModelAdapter } from "../src/adapters/openai-model-adapter";
import { FakeModelAdapter } from "../src/adapters/fake-model-adapter";
import type { CopywritingPort, DialoguePort } from "../src/domain/ports";
import { createProductCore } from "../src/domain/product-core";
import { createRequestListener } from "./app-server";
import { loadEnvFile } from "./env";
import { FileStorage } from "./file-store";
import { readLlmConfig } from "./model-config";

/** 组合根:读配置 → 建核心 → 起服务;路由与错误映射在 app-server.ts。 */

loadEnvFile();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5175);
const DATA_FILE = path.join(ROOT, "data", "db.json");

// 对话/文案分析共用 LLM 配置;转写走独立 CLI(server/audio-intake.ts),不在此组合根。
const llm = readLlmConfig(process.env);
const adapter: CopywritingPort & DialoguePort = llm.apiKey
  ? new OpenAICompatibleModelAdapter({ apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model })
  : new FakeModelAdapter();
if (!llm.apiKey) {
  console.warn(
    "[phone-coach] 未配置 MIMO_API_KEY,语言模型使用内置伪实现(仅演示);配置见 README.md",
  );
}

const core = createProductCore({
  copywriting: adapter,
  dialogue: adapter,
  storage: new FileStorage(DATA_FILE),
});

const server = http.createServer(createRequestListener({ core, staticRoot: path.join(ROOT, "dist") }));
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[phone-coach] API 服务已启动:http://127.0.0.1:${PORT}(数据文件:${DATA_FILE})`);
});
