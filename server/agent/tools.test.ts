// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createAgentCore } from "./core";
import { InMemoryLedgerStorage } from "./storage";
import { DemoWorker } from "./workers/demo";
import { createModelWorkers } from "./workers";
import type { AgentTrigger } from "./types";

/**
 * 玩家说话不再走对话 Worker 的工具循环。
 * 检索发生在 pet-bot 这一段会话里,不因每句话另开工单。
 */

describe("对话工具不再接玩家的话", () => {
  it("createModelWorkers 碰到 kind chat 不调用模型", async () => {
    let called = false;
    const worker = createModelWorkers({
      routerModel: {
        async completeStream() {
          called = true;
          return "不该出现";
        },
      },
    });
    const trigger: AgentTrigger = { id: "tr-1", source: "pet", kind: "chat", data: { text: "查一下存款" } };
    const report = await worker.run(
      { id: "t-1", triggerId: "tr-1", thread: { kind: "commandId", key: "tr-1" } },
      trigger,
      { onReport: async () => undefined },
    );
    expect(called).toBe(false);
    expect(report.status).toBe("dropped");
  });

  it("核心拒绝 kind chat,账本保持空白", async () => {
    const core = createAgentCore({ storage: new InMemoryLedgerStorage(), worker: new DemoWorker() });
    await expect(core.emitTrigger({ source: "pet", kind: "chat", data: { text: "上局复盘说了啥" } })).rejects.toThrow(
      "不走触发",
    );
    expect(await core.ledger()).toEqual([]);
  });
});
