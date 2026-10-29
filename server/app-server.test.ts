import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FakeModelAdapter } from "../src/adapters/fake-model-adapter";
import { createProductCore } from "../src/domain/product-core";
import { InMemoryStorage } from "../src/product/in-process-product-api";
import { createRequestListener } from "./app-server";
import { createHttpProductCore } from "../src/product/http-product-api";

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
  return { status: response.status, json, headers: response.headers };
}

describe("http 契约:成功与业务错误码", () => {
  it('浏览器接口持久保存判断并创建可靠关键轮分支，非法输入返回400', async () => {
    const api = createHttpProductCore(base);
    const call = await api.quickStart();
    await api.sendCustomerTurn(call.id, '喂');
    const note = { managerTurnNumber: 2, judgement: 'uncertain' as const, evidence: '未说明条件', nextExperiment: '换个条件', revealed: true, marked: true };
    await api.saveObservation(call.id, note);
    expect((await api.getConversation(call.id)).observations).toEqual([note]);
    await api.finishConversation(call.id);
    const branch = await api.branchConversation(call.id, 1, '我想了解条件');
    expect(branch.branch?.originalCustomerText).toBe('喂');
    expect(branch.turns[0].text).toBe('我想了解条件');
    expect((await api.getConversation(call.id)).turns[0].text).toBe('喂');
    expect((await request(`/api/conversations/${call.id}/observations`, 'PUT', { ...note, managerTurnNumber: 1 })).status).toBe(400);
    expect((await request(`/api/conversations/${call.id}/branch`, 'POST', { customerTurnNumber: 2, replacementText: '换句' })).status).toBe(400);
  });
  it("浏览器接口保存原局关联", async () => {
    const api = createHttpProductCore(base);
    const first = await api.quickStart();
    await api.finishConversation(first.id);
    const replay = await api.startConversation(first.personaId, { replayOfId: first.id });
    expect(await api.getConversation(replay.id)).toMatchObject({ replayOfId: first.id });
    await api.finishConversation(replay.id);
    expect(await api.getResult(replay.id)).toMatchObject({ replayOfId: first.id });
  });
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
    // 超限响应后仍可正常请求,不能用提前断连接代替可读错误。
    expect((await request("/api/personas")).status).toBe(200);
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

describe("http 契约:用户输入与状态错误返回 400,不落 500", () => {
  it("空发言、非文字发言、已结束通话发言 → 400", async () => {
    const call = (await request("/api/quickstart", "POST", {})).json as { id: string };
    const blank = await request(`/api/conversations/${call.id}/turns`, "POST", { text: "  " });
    expect(blank.status).toBe(400);
    expect(blank.json?.error).toBe("客户发言为空");
    const numeric = await request(`/api/conversations/${call.id}/turns`, "POST", { text: 123 });
    expect(numeric.status).toBe(400);
    expect(numeric.json?.error).not.toContain("is not a function");
    await request(`/api/conversations/${call.id}/finish`, "POST", {});
    expect((await request(`/api/conversations/${call.id}/turns`, "POST", { text: "喂" })).status).toBe(400);
    expect((await request(`/api/conversations/${call.id}/regenerate`, "POST", {})).status).toBe(400);
  });

  it("未结束通话取结果、无经理轮重新生成 → 400", async () => {
    const call = (await request("/api/quickstart", "POST", {})).json as { id: string };
    expect((await request(`/api/conversations/${call.id}/result`)).status).toBe(400);
    expect((await request(`/api/conversations/${call.id}/regenerate`, "POST", {})).status).toBe(400);
  });

  it("素材分析缺转写稿或标题非文字 → 400", async () => {
    const missing = await request("/api/materials/analyze", "POST", {});
    expect(missing.status).toBe(400);
    expect(missing.json?.error).toBe("转写稿内容为空");
    expect((await request("/api/materials/analyze", "POST", { transcript: "  " })).status).toBe(400);
    expect((await request("/api/materials/analyze", "POST", { transcript: "经理:您好", title: 7 })).status).toBe(400);
  });

  it("自定义画像含非文字条目 → 丢弃该条目,仍 200", async () => {
    const { status, json } = await request("/api/personas", "POST", { name: 5, visible: ["  年长  ", 3, null], hidden: [{}] });
    expect(status).toBe(200);
    expect(json).toMatchObject({ name: "自定义生客", visible: ["年长"], hidden: [] });
  });
});

describe("流式轮次端点(票 29)", () => {
  it("SSE 依次输出 delta 与 done,done 携带权威会话", async () => {
    const start = await request("/api/quickstart", "POST", {});
    const conversationId = String((start.json as { id?: string }).id ?? "");

    const response = await fetch(`${base}/api/conversations/${conversationId}/turns/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "喂" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const raw = await response.text();
    const events = raw
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const eventName = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        return { eventName, data: data ? (JSON.parse(data) as Record<string, unknown>) : null };
      });

    // 伪适配器整段话术单次回调 → 恰一个 delta,随后 done。
    const deltas = events.filter((e) => e.eventName === "delta");
    const done = events.find((e) => e.eventName === "done");
    expect(deltas.length).toBe(1);
    expect(typeof deltas[0]?.data?.text).toBe("string");
    expect((done?.data as { turns?: unknown[] })?.turns?.length).toBe(2);
    expect((done?.data as { status?: string })?.status).toBe("ongoing");
    // done 事件是最后一条:客户端读到它即可安全关流。
    expect(events.at(-1)?.eventName).toBe("done");
  });

  it("流中错误以 error 事件送达,不落 JSON 错误码", async () => {
    const response = await fetch(`${base}/api/conversations/not-exists/turns/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "喂" }),
    });
    // 响应头已按 SSE 写出(200),错误只能走事件通道。
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toMatch(/event: error/);
    expect(raw).toMatch(/不存在/);
  });
});

describe("重新生成路由(票 31)", () => {
  it("POST /regenerate 重摇最后一轮经理话术 → 200,轮次结构不变", async () => {
    const start = await request("/api/quickstart", "POST", {});
    const conversationId = String((start.json as { id?: string }).id ?? "");
    const sent = await request(`/api/conversations/${conversationId}/turns`, "POST", { text: "喂" });
    const before = (sent.json as { turns?: Array<{ speaker: string }> }).turns;

    const { status, json } = await request(`/api/conversations/${conversationId}/regenerate`, "POST", {});
    const turns = (json as { turns?: Array<{ speaker: string; number: number }> }).turns;
    expect(status).toBe(200);
    expect(turns?.length).toBe(before?.length);
    expect(turns?.at(-1)?.speaker).toBe("manager");
  });

  it("不存在的通话 → 404", async () => {
    const { status } = await request("/api/conversations/not-exists/regenerate", "POST", {});
    expect(status).toBe(404);
  });
});

describe("经理角色路由", () => {
  it("GET /api/roles 返回内置角色;POST 导入合法卡 → 200,非法卡 → 400", async () => {
    const list = await request("/api/roles");
    expect(list.status).toBe(200);
    const roles = list.json as Array<{ id: string; name: string }>;
    expect(roles.map((role) => role.id)).toContain("role-xiaowang");
    expect(roles.map((role) => role.id)).toContain("role-laochen");

    const imported = await request("/api/roles", "POST", {
      name: "老周",
      description: "你是理财经理{{char}}。",
      callLogic: [{ key: "a", name: "规律", law: "为何", usage: "怎么用" }],
      rules: ["只说真话"],
      mesExample: [{ role: "user", content: "喂" }, { role: "assistant", content: "您好" }],
      postHistoryInstructions: "慢慢说。",
    });
    expect(imported.status).toBe(200);
    const role = imported.json as { id: string };
    expect(role.id).toBeTruthy();

    const broken = await request("/api/roles", "POST", { name: "" });
    expect(broken.status).toBe(400);
    expect((broken.json as { error?: string }).error).toContain("角色卡不合法");
  });

  it("POST /api/conversations 带 roleId:角色随开局快照;未知角色 → 404", async () => {
    const personas = (await request("/api/personas")).json as Array<{ id: string }>;
    const started = await request("/api/conversations", "POST", {
      personaId: personas[0]!.id,
      roleId: "role-laochen",
    });
    expect(started.status).toBe(200);
    const conversation = started.json as { resources?: { role?: { id: string; name: string } } };
    expect(conversation.resources?.role).toMatchObject({ id: "role-laochen", name: "老陈" });

    const missing = await request("/api/conversations", "POST", {
      personaId: personas[0]!.id,
      roleId: "role-nobody",
    });
    expect(missing.status).toBe(404);
  });
});

describe("周度投研报告路由", () => {
  it("GET /api/research/current 返回当前 4 个即查分段", async () => {
    const res = await request("/api/research/current");
    expect(res.status).toBe(200);
    const report = res.json as {
      id: string;
      sections: {
        macro: { headline: string };
        sector: { leadingSectors: unknown[] };
        product: { allocationAdvice: unknown };
        risk: { objections: unknown[] };
      };
    };
    expect(report.id).toBeTruthy();
    expect(report.sections.macro.headline).toContain("底部区间");
    expect(report.sections.sector.leadingSectors).toBeDefined();
    expect(report.sections.product.allocationAdvice).toBeDefined();
    expect(report.sections.risk.objections).toBeDefined();
  });

  it("GET /api/research/download 响应为周报文件下载", async () => {
    const res = await request("/api/research/download");
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("weekly-investment-report");
  });

  it("周报预览返回独立报告，不加载应用首页", async () => {
    const res = await fetch(`${base}/reports/weekly-report.html`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("周度投研分析报告");
    expect(html).not.toMatch(/\/@vite\/client|\/src\/main\.tsx|id="root"/);
  });

  it("缺失的周报返回 404，不回退到应用首页", async () => {
    const res = await fetch(`${base}/reports/missing-report.html`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("未找到投研周报");
  });
});
