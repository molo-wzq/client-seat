import { describe, expect, it } from "vitest";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentCore } from "./core";
import { createModelWorkers, type ApprovalSinks } from "./workers";
import { appendAgentObjection, loadCurrentResearchReport } from "../report-parser";
import { appendBlindspotDraft, listBlindspotDrafts } from "./review-queue";
import { InMemoryLedgerStorage } from "./storage";
import type { AgentTriggerInput } from "./types";

/**
 * 审批闭环(工单 16)测试缝:经核心公开接口走「草稿 waiting → 同意/驳回」,
 * 断言数据源里确实出现该草稿(投研→本周异议包;盲区→策略卡人审队列),
 * 驳回则归档附理由;不上牌库(ADR 0007 闸门:队列只是草稿,发布仍走人审)。
 * 数据源写临时目录,不碰仓库 data/。
 */

const command = (text: string): AgentTriggerInput => ({ source: "pet", kind: "command", data: { text } });

/** 真实数据源落地临时目录的审批缝(生产同款,只是目录换掉)。 */
function tempDirSinks(dir: string): ApprovalSinks {
  return {
    fileResearch: (draft) => {
      appendAgentObjection(dir, { question: "本周要点(桌宠整理)", reply: draft });
    },
    queueBlindspot: (draft) => {
      appendBlindspotDraft(dir, draft);
    },
  };
}

function makeCore(dir: string) {
  return createAgentCore({
    storage: new InMemoryLedgerStorage(),
    worker: createModelWorkers({
      demoSleep: async () => undefined,
      demoChatSleep: async () => undefined,
      approvals: tempDirSinks(dir),
    }),
    // 投研/盲区是 Agent 主动规则(R4/R7),auto 才立项;决议命令本身不受放权约束。
    initialAcceptMode: "auto",
  });
}

describe("审批闭环(工单 16)", () => {
  it("同意投研草稿:写入本周投研异议包(标注「桌宠起草·已审」),数据源里确实出现该草稿", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "client-seat-approval-test-"));
    try {
      const core = makeCore(dir);
      const research = await core.emitTrigger({ source: "research", kind: "research-due", data: { weekId: "w-1" } });
      expect(research.report?.status).toBe("waiting");
      const draft = research.report?.text ?? "";

      await core.emitTrigger(command(`同意 ${research.ticket!.id}`));

      // 数据源里确实出现:情报档案夹读同一个 JSON,标注「桌宠起草·已审」。
      const objections = loadCurrentResearchReport(dir).sections.risk.objections;
      const filed = objections.find((item) => item.reply === draft);
      expect(filed).toBeDefined();
      expect(filed?.question).toContain("桌宠起草·已审");
      // 目标工单 ready;决定工单在对话里回一句「已放进本周档案夹」。
      const tickets = await core.tickets();
      expect(tickets.find((t) => t.ticketId === research.ticket!.id)?.status).toBe("ready");
      expect(tickets.some((t) => t.text.includes("已放进本周档案夹"))).toBe(true);
    } finally {
      await rm(path.join(dir, "data"), { force: true, recursive: true });
      await rmdir(dir);
    }
  });

  it("同意盲区草稿:进策略卡人审队列,不直接上牌库;数据源里确实出现该草稿", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "client-seat-approval-test-"));
    try {
      const core = makeCore(dir);
      const blindspot = await core.emitTrigger({
        source: "materials",
        kind: "cards-published",
        data: { materialId: "m-1", cardIds: ["sc-1"] },
      });
      expect(blindspot.report?.status).toBe("waiting");

      await core.emitTrigger(command(`同意 ${blindspot.ticket!.id}`));

      // 人审队列里出现草稿;队列只是草稿清单,Worker 手上没有发布接口。
      const queue = listBlindspotDrafts(dir);
      expect(queue).toHaveLength(1);
      expect(queue[0]?.draft).toBe(blindspot.report?.text);
      const tickets = await core.tickets();
      expect(tickets.find((t) => t.ticketId === blindspot.ticket!.id)?.status).toBe("ready");
      expect(tickets.some((t) => t.text.includes("人审队列"))).toBe(true);
    } finally {
      await rm(path.join(dir, "data"), { force: true, recursive: true });
      await rmdir(dir);
    }
  });

  it("驳回:草稿归档并附理由;目标工单 dropped,理由进账本", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "client-seat-approval-test-"));
    try {
      const core = makeCore(dir);
      const research = await core.emitTrigger({ source: "research", kind: "research-due", data: { weekId: "w-1" } });

      await core.emitTrigger(command(`驳回 ${research.ticket!.id} 要点太虚,重写`));

      const tickets = await core.tickets();
      expect(tickets.find((t) => t.ticketId === research.ticket!.id)?.status).toBe("dropped");
      // 归档文案带上理由;什么都没写则标「未说明」,不空着。
      expect(tickets.find((t) => t.ticketId === research.ticket!.id)?.text).toContain("要点太虚,重写");
      // 驳回不写任何数据源。
      expect(listBlindspotDrafts(dir)).toHaveLength(0);
      expect(loadCurrentResearchReport(dir).sections.risk.objections).toHaveLength(2);
    } finally {
      await rm(path.join(dir, "data"), { force: true, recursive: true });
      await rmdir(dir);
    }
  });

  it("没有待办时照旧直说,不误写数据源(工单 15 行为不回退)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "client-seat-approval-test-"));
    try {
      const core = makeCore(dir);
      const outcome = await core.emitTrigger(command("同意 t-not-exist"));

      expect(outcome.report).toMatchObject({ status: "ready" });
      expect(outcome.report?.text).toContain("没有");
      expect(loadCurrentResearchReport(dir).sections.risk.objections).toHaveLength(2);
    } finally {
      await rm(path.join(dir, "data"), { force: true, recursive: true });
      await rmdir(dir);
    }
  });
});
