// @vitest-environment node
import { once } from "node:events";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { assemblePetSystemPrompt, DEFAULT_PET_PERSONA } from "./pet-persona";
import type { AgentTriggerInput } from "../../src/shared/agent-contract";
import { FakeModelAdapter } from "../../src/adapters/fake-model-adapter";
import { createProductCore } from "../../src/domain/product-core";
import { InMemoryStorage } from "../../src/product/in-process-product-api";
import { createAgentClient } from "../../src/ui/agent-client";
import type { XiaobeiChatEvent } from "../../src/shared/agent-contract";
import { createRequestListener } from "../app-server";
import { buildDefaultResearchReport } from "../report-parser";
import { createBotArchive, loadBotReports } from "./bot-archive";
import { createAgentCore } from "./core";
import { createPetBot } from "./pet-bot";
import { InMemoryLedgerStorage } from "./storage";
import { DemoWorker } from "./workers/demo";

it("通过实际 HTTP 跨局、跨期查证据，个人笔记和回复不进共享账本或其他请求", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaobei-archive-"));
  const demo = new FakeModelAdapter();
  const core = createProductCore({ copywriting: demo, dialogue: demo, storage: new InMemoryStorage() });
  const agent = createAgentCore({ worker: new DemoWorker(), storage: new InMemoryLedgerStorage() });
  const broadcast: unknown[] = [];
  agent.subscribe((event) => broadcast.push(event));
  const markers = ["旧局保留原话", "新局保留原话"];
  const model = {
    async completeWithTools(messages: import("./workers").AgentModelMessage[]) {
      const previous = messages.filter((message) => message.role === "tool").length;
      if (previous >= 2) return { type: "text" as const, text: "可以回答" };
      return { type: "tool_calls" as const, calls: [{
        id: `lookup-${previous}`, name: "search_archive",
        arguments: JSON.stringify(previous === 0 ? { query: "保留原话", kinds: ["games"] }
          : { query: "", kinds: ["research", "notes"] }),
      }] };
    },
    async completeStream(messages: import("./workers").AgentModelMessage[], delta?: (piece: string) => void) {
      const toolEvidence = messages.filter((message) => message.role === "tool").map((message) => message.content).join(" ");
      expect(markers.every((marker) => toolEvidence.includes(marker))).toBe(true);
      const text = toolEvidence.includes("合成私有笔记") ? "找到了你的笔记。" : "没有找到个人笔记。";
      delta?.(text.slice(0, 4));
      delta?.(text.slice(4));
      return text;
    },
  };
  const petBot = createPetBot({ archive: createBotArchive(core, () => loadBotReports(directory)), model });
  const server = http.createServer(createRequestListener({ core, staticRoot: "", agent, petBot }));
  try {
    for (const text of markers) {
      const game = await core.quickStart();
      await core.sendCustomerTurn(game.id, text);
      await core.finishConversation(game.id);
    }
    const report = buildDefaultResearchReport();
    for (const period of ["第一期", "第二期"]) {
      await writeFile(path.join(directory, `${period}.json`), JSON.stringify({ ...report, id: period, period }));
    }
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server is not listening");
    const base = `http://127.0.0.1:${address.port}`;
    const run = async (client: ReturnType<typeof createAgentClient>, notes: { id: string; text: string; evidence: [] }[]) => {
      const events: XiaobeiChatEvent[] = [];
      await client.sendChat({ sessionId: "session-a", text: "比较两场，再看历期周报和笔记", notes, history: [] }, (event) => events.push(event));
      return events;
    };
    const [own, other] = await Promise.all([
      run(createAgentClient({ baseUrl: base }), [{ id: "mine", text: "合成私有笔记", evidence: [] }]),
      run(createAgentClient({ baseUrl: base }), []),
    ]);
    expect(own.map(({ type }) => type)).toEqual(["step", "step", "delta", "delta", "done"]);
    const done = own.at(-1);
    expect(done).toMatchObject({ type: "done", message: { body: "找到了你的笔记。", speaker: "pet" } });
    expect(JSON.stringify(done)).toContain("第一期");
    expect(JSON.stringify(done)).toContain("第二期");
    expect(JSON.stringify(other)).not.toContain("合成私有笔记");
    expect(other.at(-1)).toMatchObject({ type: "done", message: { body: "没有找到个人笔记。" } });
    expect(broadcast).toEqual([]);
    expect(await agent.ledger()).toEqual([]);
    for (const [source, kind] of [["pet", "chat"], ["research", "research-due"], ["materials", "cards-published"]]) {
      const res = await fetch(`${base}/api/agent/triggers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, kind, data: { text: "旧入口" } }),
      });
      expect(res.status).toBe(400);
    }
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it("同一段会话里追问不另开工单;审批才跟踪,复盘只引用资料", async () => {
  const prompts: string[] = [];
  const opened: AgentTriggerInput[] = [];
  const model = {
    async completeStream(messages: import("./workers").AgentModelMessage[], delta?: (piece: string) => void) {
      prompts.push(messages.map((message) => message.content).join("\n"));
      const text = "[wave]经理这句是在探安排,你可以先问条件,我不定你怎么接。";
      delta?.(text);
      return text;
    },
  };
  const petBot = createPetBot({
    archive: () => ({
      search: () => [{ id: "game:1", title: "上局", excerpt: "经理先接住了到期的话。" }],
      periods: [],
    }) as unknown as ReturnType<Parameters<typeof createPetBot>[0]["archive"]>,
    model,
    openWork: async (input) => {
      opened.push(input);
      return {
        triggerId: "tr-work",
        admitted: true,
        ticket: { id: "t-work", triggerId: "tr-work", thread: { kind: "commandId", key: "tr-work" } },
        report: { ticketId: "t-work", status: "ready", text: "好，已照办。" },
      };
    },
  });
  const first: import("../../src/shared/agent-contract").XiaobeiChatEvent[] = [];
  await petBot({ sessionId: "same-session", text: "在吗", history: [], notes: [] }, (event) => first.push(event));
  const follow: typeof first = [];
  await petBot({
    sessionId: "same-session",
    text: "那经理这句呢",
    history: [
      { speaker: "player", body: "在吗" },
      { speaker: "pet", body: "我在呢" },
    ],
    notes: [],
  }, (event) => follow.push(event));
  expect(prompts.at(-1)).toContain("在吗");
  expect(prompts.at(-1)).toContain("我在呢");
  expect(assemblePetSystemPrompt(DEFAULT_PET_PERSONA)).not.toContain("【建议】");
  expect(opened.filter((input) => input.kind === "chat")).toEqual([]);

  opened.length = 0;
  const review: typeof first = [];
  await petBot({ sessionId: "same-session", text: "帮我看看上局复盘", history: [], notes: [] }, (event) => review.push(event));
  const reviewDone = review.at(-1);
  expect(reviewDone).toMatchObject({ type: "done" });
  expect(JSON.stringify(reviewDone)).toContain("经理先接住了到期的话");
  expect(opened).toEqual([]);

  const approval: typeof first = [];
  await petBot({ sessionId: "same-session", text: "同意 t-work", history: [], notes: [] }, (event) => approval.push(event));
  expect(opened).toEqual([{ source: "pet", kind: "command", data: { text: "同意 t-work" } }]);
  expect(approval.at(-1)).toMatchObject({ type: "done", message: { ticketId: "t-work", body: "好，已照办。" } });
});
