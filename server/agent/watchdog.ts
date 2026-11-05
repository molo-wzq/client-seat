import type { AgentCore } from "./core";
import type { ReportStatus } from "./types";

/**
 * Watchdog(工单 09,spec 故事 16):定时巡检账本,工单超过阈值没有新 Report 时,
 * 先重试一次(重启 Worker);再超时就追加 blocked Report 写明原因、进待办。
 * 只盯「还在跑」的工单——waiting 是等人决定,ready/dropped/failed/blocked 已收口;
 * Watchdog 的汇报不发桌宠气泡。时钟与阈值可注入,测试用假钟直接驱动 check()。
 */

/** 超时阈值:默认 10 分钟没有新 Report 才干预。 */
const DEFAULT_THRESHOLD_MS = 10 * 60 * 1000;
/** 巡检间隔:生产默认每分钟看一眼账本。 */
const DEFAULT_INTERVAL_MS = 60 * 1000;

/** 依赖缝:agent 是核心的三个只读/受控入口;now/threshold/interval 均可注入。 */
export interface WatchdogDeps {
  agent: Pick<AgentCore, "ledger" | "retryTicket" | "appendSystemReport">;
  /** 干预阈值(毫秒),默认 10 分钟。 */
  thresholdMs?: number;
  /** 巡检间隔(毫秒),默认 1 分钟。 */
  intervalMs?: number;
  /** 可注入时钟(测试);默认 Date.now。 */
  now?: () => number;
}

export interface Watchdog {
  /** 手动巡检一次(测试直接调;生产由 start 定时调)。 */
  check(): Promise<void>;
  /** 按间隔自动巡检;重复 start 无副作用。 */
  start(): void;
  /** 停止自动巡检。 */
  stop(): void;
}

/** 每张工单的观察状态:最新条目序、该状态首见时刻、上次重试时刻(null=未重试)。 */
interface TicketWatch {
  lastSeq: number;
  sinceMs: number;
  retriedAtMs: number | null;
}

export function createWatchdog(deps: WatchdogDeps): Watchdog {
  const { agent } = deps;
  const thresholdMs = deps.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const watched = new Map<string, TicketWatch>();
  let timerId: ReturnType<typeof setInterval> | null = null;

  async function check(): Promise<void> {
    const entries = await agent.ledger();
    const current = now();

    // 折出每张工单的最新条目:立项 seq 与最新 Report(账本只追加,顺序即最新)。
    const latest = new Map<string, { seq: number; status: ReportStatus | null }>();
    for (const entry of entries) {
      if (entry.type === "ticket") latest.set(entry.ticket.id, { seq: entry.seq, status: null });
      else if (entry.type === "report") {
        latest.set(entry.report.ticketId, { seq: entry.seq, status: entry.report.status });
      }
    }

    for (const [ticketId, view] of latest) {
      const state = watched.get(ticketId);
      if (!state || state.lastSeq < view.seq) {
        // 新进展重新计时，但保留重试次数，避免每次重试报 progress 后无限重启。
        watched.set(ticketId, { lastSeq: view.seq, sinceMs: current, retriedAtMs: state?.retriedAtMs ?? null });
        continue;
      }
      // waiting=待人决定,ready/dropped/failed/blocked=已收口:都不归 Watchdog 管。
      if (view.status !== null && view.status !== "progress") continue;
      if (current - state.sinceMs <= thresholdMs) continue;

      if (state.retriedAtMs === null) {
        state.retriedAtMs = current;
        await agent.retryTicket(ticketId); // 先重试一次(重启 Worker)
        continue;
      }
      if (current - state.retriedAtMs <= thresholdMs) continue;
      // 再超时:标受阻、写原因、进待办;blocked Report 本身就是新进展,不会重复干预。
      await agent.appendSystemReport({
        ticketId,
        status: "blocked",
        text: `${describeThreshold(thresholdMs)}没有新进展，重试一次仍卡住，先标受阻，等你在待办里处理。`,
      });
    }
  }

  return {
    check,
    start() {
      if (timerId !== null) return;
      timerId = setInterval(() => void check(), intervalMs);
    },
    stop() {
      if (timerId === null) return;
      clearInterval(timerId);
      timerId = null;
    },
  };
}

/** 阈值的人话:够一分钟按分钟说,不够按秒说(测试常用短阈值)。 */
function describeThreshold(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} 分钟` : `${Math.round(ms / 1000)} 秒`;
}
