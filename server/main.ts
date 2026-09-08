import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_NAME,
  OpenAICompatibleModelAdapter,
} from "../src/adapters/openai-model-adapter";
import { FakeModelAdapter } from "../src/adapters/fake-model-adapter";
import type { CopywritingPort, DialoguePort } from "../src/domain/ports";
import { createProductCore } from "../src/domain/product-core";
import type { MaterialDraftPatch } from "../src/domain/types";
import { FileStorage } from "./file-store";
import { loadEnvFile } from "./env";

loadEnvFile();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5175);
const DATA_FILE = path.join(ROOT, "data", "db.json");

const apiKey = process.env.MIMO_API_KEY;
const adapter: CopywritingPort & DialoguePort = apiKey
  ? new OpenAICompatibleModelAdapter({
      apiKey,
      baseUrl: process.env.MIMO_BASE_URL || DEFAULT_MODEL_BASE_URL,
      model: process.env.MIMO_MODEL || DEFAULT_MODEL_NAME,
    })
  : new FakeModelAdapter();
if (!apiKey) {
  console.warn(
    "[phone-coach] 未配置 MIMO_API_KEY,语言模型使用内置伪实现(仅演示);配置见 README.md",
  );
}

const core = createProductCore({ copywriting: adapter, dialogue: adapter, storage: new FileStorage(DATA_FILE) });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      serveStatic(res, url.pathname);
    }
  } catch (error) {
    respondJson(res, 500, { error: (error as Error).message });
  }
});

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<void> {
  const body = await readJsonBody(req);

  if (req.method === "POST" && pathname === "/api/materials/analyze") {
    const material = await core.analyzeTranscript(body as { title?: string; transcript: string });
    respondJson(res, 200, material);
    return;
  }
  const publishMatch = pathname.match(/^\/api\/materials\/([^/]+)\/publish$/);
  if (req.method === "POST" && publishMatch) {
    const materialId = decodeURIComponent(publishMatch[1]);
    const cardIds = (body as { cardIds?: unknown }).cardIds;
    const material = Array.isArray(cardIds)
      ? await core.publishCards(materialId, cardIds.filter((id): id is string => typeof id === "string"))
      : await core.publishMaterialCards(materialId);
    respondJson(res, 200, material);
    return;
  }
  const draftMatch = pathname.match(/^\/api\/materials\/([^/]+)\/draft$/);
  if (req.method === "PATCH" && draftMatch) {
    const material = await core.updateMaterialDraft(
      decodeURIComponent(draftMatch[1]),
      body as MaterialDraftPatch,
    );
    respondJson(res, 200, material);
    return;
  }
  if (req.method === "GET" && pathname === "/api/personas") {
    respondJson(res, 200, await core.listPersonas());
    return;
  }
  if (req.method === "POST" && pathname === "/api/personas") {
    const input = body as { name?: string; visible?: string[]; hidden?: string[] };
    const persona = await core.savePersona({
      name: input.name || "",
      visible: Array.isArray(input.visible) ? input.visible : [],
      hidden: Array.isArray(input.hidden) ? input.hidden : [],
    });
    respondJson(res, 200, persona);
    return;
  }
  if (req.method === "POST" && pathname === "/api/conversations") {
    const conversation = await core.startConversation((body as { personaId?: string }).personaId || "");
    respondJson(res, 200, conversation);
    return;
  }
  const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (req.method === "GET" && conversationMatch) {
    const conversation = await core.getConversation(decodeURIComponent(conversationMatch[1]));
    respondJson(res, 200, conversation);
    return;
  }
  const turnMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/turns$/);
  if (req.method === "POST" && turnMatch) {
    const conversation = await core.sendCustomerTurn(
      decodeURIComponent(turnMatch[1]),
      (body as { text?: string }).text || "",
    );
    respondJson(res, 200, conversation);
    return;
  }
  const finishMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/finish$/);
  if (req.method === "POST" && finishMatch) {
    const conversation = await core.finishConversation(decodeURIComponent(finishMatch[1]));
    respondJson(res, 200, conversation);
    return;
  }
  const resultMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/result$/);
  if (req.method === "GET" && resultMatch) {
    const result = await core.getResult(decodeURIComponent(resultMatch[1]));
    respondJson(res, 200, result);
    return;
  }
  respondJson(res, 404, { error: `未知接口:${req.method} ${pathname}` });
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function respondJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveStatic(res: http.ServerResponse, pathname: string): void {
  const distDir = path.join(ROOT, "dist");
  const safePath = path.normalize(pathname).replace(/^([.][.][/\\])+/, "");
  let filePath = path.join(distDir, safePath);
  if (!filePath.startsWith(distDir)) filePath = path.join(distDir, "index.html");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("未找到构建产物:请先运行 npm run build");
    return;
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
  };
  res.writeHead(200, {
    "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[phone-coach] API 服务已启动:http://127.0.0.1:${PORT}(数据文件:${DATA_FILE})`);
});
