import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { ProductCore } from "../src/domain/product-core";
import { NotFoundError, ValidationError } from "../src/domain/product-core";
import type { MaterialDraftPatch } from "../src/domain/types";

/**
 * API 请求处理:路由 + body 解析 + 静态文件服务 + 统一错误映射。
 * 与 UI 契约(server/app-server.test.ts 钉住):不存在→404、输入不合法→400、其余→500。
 */
export function createRequestListener(deps: {
  core: ProductCore;
  staticRoot: string;
}): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { core, staticRoot } = deps;

  return (req, res) => {
    void handle(req, res);
  };

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url.pathname);
      } else {
        serveStatic(res, url.pathname, staticRoot);
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        respondJson(res, 404, { error: error.message });
      } else if (error instanceof ValidationError) {
        respondJson(res, 400, { error: error.message });
      } else {
        respondJson(res, 500, { error: (error as Error).message });
      }
    }
  }

  async function handleApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<void> {
    const body = await readJsonBody(req);

    if (req.method === "POST" && pathname === "/api/materials/analyze") {
      const input = body as { title?: string; transcript: string; kind?: string };
      // kind 合法性由领域校验(ValidationError→400),server 不再重复预校验。
      const material = await core.analyzeTranscript({
        title: input.title,
        transcript: input.transcript,
        kind: input.kind as MaterialDraftPatch["kind"],
      });
      respondJson(res, 200, material);
      return;
    }
    if (req.method === "GET" && pathname === "/api/materials") {
      respondJson(res, 200, await core.listMaterials());
      return;
    }
    const materialGetMatch = pathname.match(/^\/api\/materials\/([^/]+)$/);
    if (req.method === "GET" && materialGetMatch) {
      respondJson(res, 200, await core.getMaterial(decodeURIComponent(materialGetMatch[1])));
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
    if (req.method === "POST" && pathname === "/api/quickstart") {
      respondJson(res, 200, await core.quickStart());
      return;
    }
    if (req.method === "GET" && pathname === "/api/conversations") {
      respondJson(res, 200, await core.listConversations());
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

function serveStatic(res: http.ServerResponse, pathname: string, distDir: string): void {
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
