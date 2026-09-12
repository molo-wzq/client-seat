import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FakeModelAdapter } from "../src/adapters/fake-model-adapter";
import { createProductCore } from "../src/domain/product-core";
import { InMemoryStorage } from "../src/product/in-process-product-api";
import { createRequestListener } from "./app-server";

/** http 层契约(审计 C5):错误码由领域错误类型驱动,浏览器与进程内看到同一语义。 */

let server: http.Server;
let base = "";

beforeAll(async () => {
  const core = createProductCore({
    copywriting: new FakeModelAdapter(),
    dialogue: new FakeModelAdapter(),
    storage: new InMemoryStorage(),
  });
  server = http.createServer(createRequestListener({ core, staticRoot: "" }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function request(apiPath: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${apiPath}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  return { status: response.status, json };
}

describe("http 契约:成功与业务错误码", () => {
  it("合法转写分析 → 200 且返回素材", async () => {
    const { status, json } = await request("/api/materials/analyze", "POST", {
      transcript: "T01 经理:您好\nT02 客户:喂",
      kind: "顺利沟通",
    });
    expect(status).toBe(200);
    expect((json as { id?: string }).id).toBeDefined();
  });

  it("非法素材类型 → 400(analyze 路径)", async () => {
    const { status, json } = await request("/api/materials/analyze", "POST", {
      transcript: "T01 经理:您好",
      kind: "垃圾类型",
    });
    expect(status).toBe(400);
    expect(json?.error).toContain("素材类型不合法");
  });

  it("PATCH 草稿非法素材类型 → 400(与 analyze 同规则同码)", async () => {
    const analyzed = await request("/api/materials/analyze", "POST", {
      transcript: "T01 经理:您好\nT02 客户:喂",
    });
    const materialId = (analyzed.json as { id: string }).id;
    const { status, json } = await request(`/api/materials/${materialId}/draft`, "PATCH", {
      kind: "垃圾类型",
    });
    expect(status).toBe(400);
    expect(json?.error).toContain("素材类型不合法");
  });

  it("不存在的素材 → 404", async () => {
    const { status, json } = await request("/api/materials/does-not-exist");
    expect(status).toBe(404);
    expect(json?.error).toContain("素材不存在");
  });

  it("PATCH 不存在素材的草稿 → 404", async () => {
    const { status } = await request("/api/materials/does-not-exist/draft", "PATCH", { turns: [] });
    expect(status).toBe(404);
  });

  it("不存在通话的结果 → 404", async () => {
    const { status, json } = await request("/api/conversations/nope/result");
    expect(status).toBe(404);
    expect(json?.error).toContain("通话不存在");
  });

  it("未知接口 → 404", async () => {
    const { status } = await request("/api/no-such-route");
    expect(status).toBe(404);
  });

  it("请求体超过 2MB 上限 → 413,错误响应可达客户端", async () => {
    const response = await fetch(`${base}/api/materials/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "x".repeat(3 * 1024 * 1024) }),
    });
    expect(response.status).toBe(413);
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    expect(json?.error).toContain("请求体过大");
  });

  it("请求体为合法 JSON 但顶层非对象 → 400", async () => {
    const response = await fetch(`${base}/api/materials/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    expect(response.status).toBe(400);
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    expect(json?.error).toContain("JSON 对象");
  });

  it("请求体不是合法 JSON → 400", async () => {
    const response = await fetch(`${base}/api/materials/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(response.status).toBe(400);
    expect((await response.json().catch(() => null) as { error?: string } | null)?.error).toContain("合法 JSON");
  });

  it("路径参数含非法百分号编码 → 404(不落 500)", async () => {
    const { status } = await request("/api/materials/%zz");
    expect(status).toBe(404);
  });

  it("快速开始 → 200(演示适配器下完整可用)", async () => {
    const { status, json } = await request("/api/quickstart", "POST", {});
    expect(status).toBe(200);
    expect((json as { status?: string }).status).toBe("ongoing");
  });
});
