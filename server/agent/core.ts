import { randomId } from "../../src/domain/ports";
import { ValidationError } from "../../src/domain/product-core";
import type {
  AgentDecision,
  AgentEvent,
  AgentReport,
  AgentTicket,
  AgentTrigger,
  AgentTriggerInput,
  LedgerEntry,
} from "./types";
import type { LedgerStorage } from "./storage";

/**
 * Agent 编排核心(ADR 0007:可整体替换,只暴露 emitTrigger / subscribe / ledger)。
 * 链路 Source→Trigger→Thread→Eval(准入)→Ticket→Worker→Report→Channel 全部藏在这里,
 * 外部(UI、HTTP)只见三个接口;日后换 DSH 或 DeerFlow 时整层替换。
 */

/** Worker:领一张工单干活,产出最终 Report。 */
export interface AgentWorker {
  run(ticket: AgentTicket, trigger: AgentTrigger): Promise<AgentReport>;
}

/**
 * 快捷环 4 条命令的确定性回复(工单 03):键与前端 DeskPet 快捷环的按钮文案一致,
 * 两端各自被测试钉住。口吻是客户侧搭档对玩家说话,不评价玩家,不超过 40 字。
 */
const QUICK_RING_REPLIES: Record<string, string> = {
  换个客户: "好，去名册挑位新客户，这就给你换上。",
  再来一局: "收到，马上重摆牌桌，再来一局。",
  上局复盘: "这就调出上局复盘，挑值得学的给你看。",
  本周投研: "本周投研已备好，这就翻开放你手边。",
};

/** demo Worker:确定性脚本回复,不调模型(无 key 演示路径;真实模型见工单 11)。 */
export class DemoWorker implements AgentWorker {
  async run(ticket: AgentTicket, trigger: AgentTrigger): Promise<AgentReport> {
    const text = typeof trigger?.data?.text === "string" ? trigger.data.text.trim() : "";
    return { ticketId: ticket.id, status: "ready", text: QUICK_RING_REPLIES[text] ?? "收到，马上办" };
  }
}

/** emitTrigger 的结果:未准入时链路止于 Decision,ticket/report 为空。 */
export interface EmitOutcome {
  triggerId: string;
  admitted: boolean;
  ticket: AgentTicket | null;
  report: AgentReport | null;
}

export interface AgentCore {
  /** 链路唯一入口:接收一次触发,同步驱动到 Report(或止于拒绝的 Decision)。 */
  emitTrigger(input: AgentTriggerInput): Promise<EmitOutcome>;
  /** 订阅对外事件(Report 与 Channel);返回退订函数。 */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** 只读账本视图(spec:前端只读账本,不直接调用 Worker)。 */
  ledger(): Promise<LedgerEntry[]>;
}

export function createAgentCore(deps: { storage: LedgerStorage; worker: AgentWorker }): AgentCore {
  const { storage, worker } = deps;
  const listeners = new Set<(event: AgentEvent) => void>();

  return {
    async emitTrigger(input) {
      if (!SOURCES.includes(input.source)) {
        throw new ValidationError(`触发来源不合法:${String(input.source)}`);
      }
      if (input.kind !== "command") {
        throw new ValidationError(`触发类型不合法:${String(input.kind)}`);
      }
      const trigger: AgentTrigger = { ...input, id: randomId() };
      await storage.appendLedgerEntry({ type: "trigger", trigger });

      const decision = evaluate(trigger);
      await storage.appendLedgerEntry({ type: "decision", decision });
      if (!decision.admitted) {
        return { triggerId: trigger.id, admitted: false, ticket: null, report: null };
      }

      // pet 命令按 spec 的 Thread 键归并:commandId = 本次触发的 id。
      const ticket: AgentTicket = {
        id: randomId(),
        triggerId: trigger.id,
        thread: { kind: "commandId", key: trigger.id },
      };
      await storage.appendLedgerEntry({ type: "ticket", ticket });

      const report: AgentReport = { ...(await worker.run(ticket, trigger)), ticketId: ticket.id };
      await storage.appendLedgerEntry({ type: "report", report });
      publish({ type: "report", report });
      publish({
        type: "channel",
        // 桌宠气泡硬上限 40 字(spec);Report 原文完整留在账本里。
        channel: { target: "pet-bubble", ticketId: ticket.id, text: [...report.text].slice(0, 40).join("") },
      });

      return { triggerId: trigger.id, admitted: true, ticket, report };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    ledger: () => storage.listLedgerEntries(),
  };

  function publish(event: AgentEvent): void {
    for (const listener of listeners) listener(event);
  }
}

/** Eval:本期只做准入——pet 命令须带非空文本;研判与放权模式见后续票。 */
function evaluate(trigger: AgentTrigger): AgentDecision {
  const text = typeof trigger.data.text === "string" ? trigger.data.text.trim() : "";
  if (text === "") return { triggerId: trigger.id, admitted: false, reason: "命令内容为空" };
  return { triggerId: trigger.id, admitted: true, reason: "pet 命令,准予立项" };
}

/** spec 的五个触发来源;输入校验在进链路之前完成。 */
const SOURCES: AgentTrigger["source"][] = ["table", "materials", "research", "pet", "system"];
