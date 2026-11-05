import { useEffect, useState } from "react";
import type { AgentClient } from "./agent-client";
import type {
  AcceptMode,
  AgentEvalRecord,
  AgentPolicy,
  AgentReport,
  AgentTicketView,
} from "../shared/agent-contract";

/**
 * Agent 观察数据 hook(工单 15):工单视图、放权、评估记录的拉取与出口。
 * DeskPet 只在 SSE 事件到达时调 upsertReport / refreshEvals,
 * 面板开合与演示脚本经 refresh 拉平;假客户端缺方法也不崩(safeFetch)。
 */

/** 一条 Report 落到工单视图上:按工单号原位更新(归并字段随原条目保留),没有则追加。 */
function upsertTicket(prev: AgentTicketView[], report: AgentReport): AgentTicketView[] {
  return prev.some((ticket) => ticket.ticketId === report.ticketId)
    ? prev.map((ticket) =>
        ticket.ticketId === report.ticketId ? { ...ticket, status: report.status, text: report.text } : ticket,
      )
    : [...prev, { ticketId: report.ticketId, status: report.status, text: report.text }];
}

/** 假客户端缺方法也不崩(App 级测试的 agent 只实现一部分接口)。 */
export function safeFetch<T>(run: () => Promise<T>, apply: (value: T) => void): void {
  try {
    run().then(apply).catch(() => undefined);
  } catch {
    // 缺方法(同步抛)静默:面板给空态。
  }
}

/** 拖入文件的类型(demo,工单 07):按 MIME 与文件名推断——音频 / 生客画像 / 角色卡。 */
function inferFileKind(file: { name: string; type: string }): "audio" | "persona" | "role" {
  if (file.type.startsWith("audio/")) return "audio";
  return /角色|role/i.test(file.name) ? "role" : "persona";
}

export function useAgentView(agent: AgentClient) {
  const [tickets, setTickets] = useState<AgentTicketView[]>([]);
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [evals, setEvals] = useState<AgentEvalRecord[]>([]);
  /** 待办到达的节拍:驱动角标重挂载,重放「晃一下」动画。 */
  const [todoShake, setTodoShake] = useState(0);

  function refreshEvals() {
    safeFetch(() => agent.evals(), setEvals);
  }

  /** 放权重拉(面板打开或演示切过)。 */
  function refreshPolicy() {
    safeFetch(() => agent.policy(), setPolicy);
    refreshEvals();
  }

  /** 放权切换:两档开关与 ⋯ 菜单观察档共用;以服务端返回为准,失败保持原样不打扰。 */
  function setMode(mode: AcceptMode) {
    safeFetch(() => agent.setAcceptMode(mode), setPolicy);
    refreshEvals();
  }

  /** 指令出口(芯片、拍板按钮共用):失败不上气泡,由账本/后续待办兜底。 */
  function sendCommand(text: string) {
    void agent.sendCommand(text).catch(() => undefined);
  }

  /** 拖放出口(工单 07):每个文件一张 dropped 触发,只带文件名与类型,demo 不读内容、不上传。 */
  function sendDroppedFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      void agent
        .sendTrigger({
          source: "materials",
          kind: "dropped",
          data: { fileName: file.name, fileKind: inferFileKind(file) },
        })
        .catch(() => undefined);
    }
  }

  /** SSE report 事件:原位刷新工单视图;待审/受阻顺带晃一下角标并刷新评估。 */
  function upsertReport(report: AgentReport) {
    setTickets((prev) => upsertTicket(prev, report));
    if (report.status === "waiting" || report.status === "blocked") {
      setTodoShake((count) => count + 1);
    }
    refreshEvals();
  }

  // 工单视图底座(工单 05):进场先拉一次只读账本视图;失败静默,SSE 仍会驱动。
  useEffect(() => {
    let alive = true;
    agent
      .tickets()
      .then((next) => {
        if (alive) setTickets(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [agent]);

  return { tickets, policy, evals, todoShake, upsertReport, refreshPolicy, refreshEvals, setMode, sendCommand, sendDroppedFiles };
}
