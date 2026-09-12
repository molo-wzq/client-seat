import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { ProductCore } from "../src/domain/product-core";
import { NotFoundError, ValidationError } from "../src/domain/product-core";
import type { MaterialDraftPatch } from "../src/domain/types";

/** 领域之外的 http 层错误:请求体超过大小上限,映射为 413。 */
class BodyTooLargeError extends Error {}

/**
 * API 请求处理:路由 + body 解析 + 静态文件服务 + 统一错误映射。
 * 与 UI 契约(server/app-server.test.ts 钉住):不存在→404、输入不合法→400、
 * 请求体超限→413、其余→500。
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
      } else if (error instanceof BodyTooLargeError) {
        // 先回 413 再关连接:req.destroy() 会连带销毁共享 socket,
        // 未等响应送达就断开,客户端只会看到连接重置。
        respondJson(res, 413, { error: error.message }, { Connection: "close" });
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
      respondJson(res, 200, await core.getMaterial(safeDecodeSegment(materialGetMatch[1])));
      return;
    }
    const publishMatch = pathname.match(/^\/api\/materials\/([^/]+)\/publish$/);
    if (req.method === "POST" && publishMatch) {
      const materialId = safeDecodeSegment(publishMatch[1]);
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
        safeDecodeSegment(draftMatch[1]),
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
      const conversation = await core.getConversation(safeDecodeSegment(conversationMatch[1]));
      respondJson(res, 200, conversation);
      return;
    }
    const turnMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/turns$/);
    if (req.method === "POST" && turnMatch) {
      const conversation = await core.sendCustomerTurn(
        safeDecodeSegment(turnMatch[1]),
        (body as { text?: string }).text || "",
      );
      respondJson(res, 200, conversation);
      return;
    }
    const finishMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/finish$/);
    if (req.method === "POST" && finishMatch) {
      const conversation = await core.finishConversation(safeDecodeSegment(finishMatch[1]));
      respondJson(res, 200, conversation);
      return;
    }
    const resultMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/result$/);
    if (req.method === "GET" && resultMatch) {
      const result = await core.getResult(safeDecodeSegment(resultMatch[1]));
      respondJson(res, 200, result);
      return;
    }
    respondJson(res, 404, { error: `未知接口:${req.method} ${pathname}` });
  }
}

/** 路径段解码:非法百分号编码按"资源不存在"处理(404),不落 500。 */
function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new NotFoundError(`资源不存在:${segment}`);
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        rejected = true;
        chunks.length = 0;
        reject(new BodyTooLargeError("请求体过大(上限 2MB)"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      if (chunks.length === 0) return resolve({});
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        // 顶层必须是 JSON 对象:数组/标量/null 对所有端点都不是合法输入。
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          reject(new ValidationError("请求体必须是 JSON 对象"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new ValidationError("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function respondJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
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
  // pipe 不监听源流 error 时,读文件失败(文件被锁/消失)会成为 uncaughtException 杀死进程。
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
