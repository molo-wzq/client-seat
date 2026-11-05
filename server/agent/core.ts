import { randomId } from "../../src/domain/ports";
import { ValidationError } from "../../src/domain/product-core";
import type {
  AcceptMode,
  AgentDecision,
  AgentEvalRecord,
  AgentEvent,
  AgentPolicy,
  AgentReport,
  AgentTicket,
  AgentTicketView,
  AgentThread,
  AgentTrigger,
  AgentTriggerInput,
  LedgerEntry,
  EmitOutcome,
} from "./types";
export type { EmitOutcome } from "./types";
import type { LedgerStorage } from "./storage";
import { foldTickets } from "./tickets";
import { findPolicyRule, foldEvals, initialPolicy } from "./policy";

/**
 * Agent 编排核心(ADR 0007:可整体替换,只暴露 emitTrigger / subscribe / ledger)。
 * 链路 Source→Trigger→Thread→Eval(准入)→Ticket→Worker→Report→Channel 全部藏在这里,
 * 外部(UI、HTTP)只见三个接口;日后换 DSH 或 DeerFlow 时整层替换。
 * 工单 05 起另提供只读查询 tickets()(账本折叠,不改三接口形状)。
 */

/**
 * Worker 汇报缝(工单 05):干活途中随时追加 Report(进展→就绪/等待),
 * 每条都先落账再发事件;返回值仍是本次触发自身工单的最终 Report。
 */
export type ReportSink = (report: AgentReport) => Promise<void>;

/** Worker 只读账本视图；决定依据与 UI 展示共用同一持久状态。 */
export interface WorkerContext {
  tickets(): Promise<AgentTicketView[]>;
}

/** Worker 领工单时的全部回调与视图,收进一个 options 对象:加参数不错位(B1)。 */
export interface WorkerRunOptions {
  /** 汇报缝:干活途中随时追加 Report,每条都先落账再发事件。 */
  onReport: ReportSink;
  /** 流式正文增量缝(工单 11):只发事件不落账,核心补上 ticketId 后推送;不支持的 Worker 忽略。 */
  onDelta?: (text: string) => void;
  /** 只读账本视图(加固):审批/批注据此找待办,不依赖 Worker 内存状态。 */
  context?: WorkerContext;
}

/** Worker:领一张工单干活,途中可经 onReport 追加汇报,最终返回一条 Report。 */
export interface AgentWorker {
  run(ticket: AgentTicket, trigger: AgentTrigger, options: WorkerRunOptions): Promise<AgentReport>;
}

export interface AgentCore {
  /** 链路唯一入口:接收一次触发,同步驱动到 Report(或止于拒绝的 Decision)。 */
  emitTrigger(input: AgentTriggerInput): Promise<EmitOutcome>;
  /** 订阅对外事件(Report 与 Channel);返回退订函数。 */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** 只读账本视图(spec:前端只读账本,不直接调用 Worker)。 */
  ledger(): Promise<LedgerEntry[]>;
  /** 只读工单视图(工单 05):账本折叠出每张工单最新状态,不追加任何条目。 */
  tickets(): Promise<AgentTicketView[]>;
  /** 只读放权策略(工单 08):版本号、当前放权模式与 R1–R7 规则数据。 */
  policy(): Promise<AgentPolicy>;
  /** 切换放权模式(工单 08):版本号 +1;非法模式抛 ValidationError(→400)。 */
  setAcceptMode(mode: AcceptMode): Promise<AgentPolicy>;
  /** 只读评估记录(工单 08):账本折叠出的「本来会做什么+为什么」清单。 */
  evals(): Promise<AgentEvalRecord[]>;
  /** 重试一张卡住的工单(工单 09,Watchdog 调):按账本里的原 Trigger 重跑 Worker,不等结果。 */
  retryTicket(ticketId: string): Promise<boolean>;
  /** 系统侧汇报(工单 09,Watchdog 调):落账并发 report 事件,不出桌宠气泡。 */
  appendSystemReport(report: AgentReport): Promise<void>;
}

export function createAgentCore(deps: {
  storage: LedgerStorage;
  worker: AgentWorker;
  /** 初始放权模式(缺省 observe);只给需要钉执行路径的既有用例与演示脚本用。 */
  initialAcceptMode?: AcceptMode;
}): AgentCore {
  const { storage, worker } = deps;
  const listeners = new Set<(event: AgentEvent) => void>();
  let policy = initialPolicy(deps.initialAcceptMode);
  const attempts = new Map<string, { token: symbol; stop(): void }>();
  const context: WorkerContext = { tickets: async () => foldTickets(await storage.listLedgerEntries()) };
  // 审批/批注串行读取并更新待办，避免并发决定重复生效；其他任务仍可并行。
  let reviewChain: Promise<void> = Promise.resolve();

  // 每条 Report(途中的与最终的)走同一条出口:先落账,再发事件;能说的才配气泡。
  const emitReport = async (report: AgentReport): Promise<void> => {
    await storage.appendLedgerEntry({ type: "report", report });
    publish({ type: "report", report });
    // dropped 的语义是沉默(spec 故事 7:没什么值得说就保持沉默);
    // blocked 进待办说明原因即可,同样不打扰玩家(spec 故事 16)。
    // 两条都照常落账与进工单视图,只是不推气泡。
    if (report.status === "dropped" || report.status === "blocked") return;
    publish({
      type: "channel",
      // 桌宠气泡硬上限 40 字(spec);Report 原文完整留在账本里。
      channel: { target: "pet-bubble", ticketId: report.ticketId, text: [...report.text].slice(0, 40).join("") },
    });
  };

  /** 首次执行与重试共享最终汇报和异常出口；新尝试使旧尝试的迟到汇报失效。 */
  async function runWorker(ticket: AgentTicket, trigger: AgentTrigger): Promise<AgentReport> {
    const attempt = Symbol(ticket.id);
    // 放弃旧执行的等待，释放审批队列；它仍可能运行，但其后续汇报会被 token 拦住。
    attempts.get(ticket.id)?.stop();
    let stop!: () => void;
    const superseded: AgentReport = { ticketId: ticket.id, status: "dropped", text: "本次执行已由重试或系统处置接管。" };
    const stopped = new Promise<AgentReport>((resolve) => { stop = () => resolve(superseded); });
    attempts.set(ticket.id, { token: attempt, stop });
    const sink: ReportSink = async (report) => {
      if (attempts.get(ticket.id)?.token === attempt) await emitReport(report);
    };
    // 流式增量缝(工单 11):Worker 只给正文片段,核心补 ticketId 后发事件,不落账;
    // 被重试或系统处置接管的旧尝试,迟到的增量与汇报一样失效。
    const onDelta = (text: string) => {
      if (attempts.get(ticket.id)?.token === attempt) publish({ type: "delta", ticketId: ticket.id, text });
    };
    const run = async (): Promise<AgentReport> => {
      try {
        return { ...(await worker.run(ticket, trigger, { onReport: sink, onDelta, context })), ticketId: ticket.id };
      } catch {
        return { ticketId: ticket.id, status: "failed", text: "工单执行失败，暂未完成，已保留记录。" };
      }
    };
    const text = typeof trigger.data.text === "string" ? trigger.data.text.trim() : "";
    // 决议命令(工单 15)允许带可选理由(工单 16 驳回附理由),都走审批串行队列。
    const mutatesWaiting = trigger.kind === "annotate" || (trigger.kind === "command" && /^(同意|驳回)\s*(\S+)?(?:\s+.+)?$/.test(text));
    const execute = () => attempts.get(ticket.id)?.token === attempt ? Promise.race([run(), stopped]) : Promise.resolve(superseded);
    const pending = mutatesWaiting ? reviewChain.then(execute) : execute();
    if (mutatesWaiting) reviewChain = pending.then(() => undefined, () => undefined);
    const report = await pending;
    await sink(report);
    if (attempts.get(ticket.id)?.token === attempt) attempts.delete(ticket.id);
    return report;
  }

  return {
    async emitTrigger(input) {
      if (!SOURCES.includes(input.source)) {
        throw new ValidationError(`触发来源不合法:${String(input.source)}`);
      }
      if (!TRIGGER_KINDS.includes(input.kind)) {
        throw new ValidationError(`触发类型不合法:${String(input.kind)}`);
      }
      // source 完全由客户端提供(S1):伪造 source 会把 inferred 触发漏成显式命令、
      // 绕过放权研判,所以每个 kind 只认它所属域的 source,不匹配直接拒绝。
      if (!KIND_SOURCES[input.kind].includes(input.source)) {
        throw new ValidationError(`触发来源与类型不匹配:${input.kind} 只能来自 ${KIND_SOURCES[input.kind].join("/")}`);
      }
      const trigger: AgentTrigger = { ...input, id: randomId(), data: sanitizeTriggerData(input.data) };
      // 账本里的触发再剔一层 context(工单 16):牌局快照含隐藏牌,只活在本次执行,
      // 不落账、不进任何只读视图;Worker 拿到的仍是上面的 trigger(含 context)。
      const ledgerTrigger: AgentTrigger = { ...trigger, data: sanitizeLedgerTriggerData(trigger.data) };
      await storage.appendLedgerEntry({ type: "trigger", trigger: ledgerTrigger });

      // Eval 两步:先做形状准入,再按放权模式给 inferred 候选定处置(工单 08)。
      const admission = evaluate(trigger);
      if (!admission.admitted) {
        await storage.appendLedgerEntry({ type: "decision", decision: admission });
        return { triggerId: trigger.id, admitted: false, ticket: null, report: null };
      }

      const rule = findPolicyRule(trigger);
      let decision = admission;
      if (rule) {
        // inferred 候选(规则主动发起):off 不评估不执行;observe 只记评估;
        // auto 记评估并立项执行。评估记录即账本里的 Disposition。
        if (policy.acceptMode === "off") {
          decision = { triggerId: trigger.id, admitted: false, reason: `放权模式 off，规则 ${rule.id} 不评估、不立项` };
        } else {
          await storage.appendLedgerEntry({
            type: "disposition",
            disposition: {
              triggerId: trigger.id,
              ruleId: rule.id,
              wouldDo: rule.wouldDo,
              why: rule.why,
              outcome: policy.acceptMode === "auto" ? "executed" : "observed",
            },
          });
          decision =
            policy.acceptMode === "auto"
              ? { triggerId: trigger.id, admitted: true, reason: `规则 ${rule.id} 命中，放权 auto 立项执行` }
              : { triggerId: trigger.id, admitted: false, reason: `放权模式 observe，规则 ${rule.id} 命中，只记录不立项` };
        }
      }
      await storage.appendLedgerEntry({ type: "decision", decision });
      if (!decision.admitted) {
        return { triggerId: trigger.id, admitted: false, ticket: null, report: null };
      }

      // Thread 键按 spec 归并:pet 命令与对话按 commandId(本次触发的 id),
      // 对局结束事件按 gameId(本局的复盘工作都归到同一局),
      // 周报到期按 weekId、策略卡发布按 materialId(工单 11 的投研/盲区线)。
      const thread: AgentThread = threadOf(trigger);
      const ticket: AgentTicket = {
        id: randomId(),
        triggerId: trigger.id,
        thread,
      };
      await storage.appendLedgerEntry({ type: "ticket", ticket });

      // 首次执行与重试同走 runWorker:汇报统一出口,流式增量(工单 11)也在这里接管。
      const report = await runWorker(ticket, trigger);

      return { triggerId: trigger.id, admitted: true, ticket, report };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    ledger: () => storage.listLedgerEntries(),

    async tickets() {
      return foldTickets(await storage.listLedgerEntries());
    },

    async policy() {
      return structuredClone(policy);
    },

    async setAcceptMode(mode) {
      if (!ACCEPT_MODES.includes(mode)) {
        throw new ValidationError(`放权模式不合法:${String(mode)}(只能是 off/observe/auto)`);
      }
      policy = { ...policy, version: policy.version + 1, acceptMode: mode };
      return structuredClone(policy);
    },

    async evals() {
      return foldEvals(await storage.listLedgerEntries());
    },

    async retryTicket(ticketId) {
      const entries = await storage.listLedgerEntries();
      const view = foldTickets(entries).find((ticket) => ticket.ticketId === ticketId);
      if (!view || view.status !== "progress") return false;
      const ticket = entries.find(
        (entry): entry is Extract<LedgerEntry, { type: "ticket" }> => entry.type === "ticket" && entry.ticket.id === ticketId,
      )?.ticket;
      if (!ticket) return false;
      const trigger = entries.find(
        (entry): entry is Extract<LedgerEntry, { type: "trigger" }> =>
          entry.type === "trigger" && entry.trigger.id === ticket.triggerId,
      )?.trigger;
      if (!trigger) return false;
      // 重启不等结果:卡住的工单本来就可能不返回,新汇报走同一条出口自然落账。
      void runWorker(ticket, trigger).catch(() => undefined);
      return true;
    },

    async appendSystemReport(report) {
      // 受阻/失败后，仍在后台运行的尝试不能再覆盖系统终态。
      if (report.status !== "progress") {
        attempts.get(report.ticketId)?.stop();
        attempts.delete(report.ticketId);
      }
      // Watchdog 的汇报只落账与 report 事件,不配气泡(spec 故事 16:不对玩家说话)。
      await storage.appendLedgerEntry({ type: "report", report });
      publish({ type: "report", report });
    },
  };

  function publish(event: AgentEvent): void {
    for (const listener of listeners) listener(event);
  }
}

/** Eval 准入:pet 命令/对话须带非空文本,对局结束事件须带对局号与轮次,拖入文件须带文件名与合法类型;研判(放权模式)在 emitTrigger 里接续。 */
function evaluate(trigger: AgentTrigger): AgentDecision {
  if (trigger.kind === "game-ended") {
    const gameId = trigger.data.gameId;
    const rounds = trigger.data.rounds;
    const complete = typeof gameId === "string" && gameId !== "" && Array.isArray(rounds) && rounds.length > 0;
    return complete
      ? { triggerId: trigger.id, admitted: true, reason: "对局结束,准予复盘立项" }
      : { triggerId: trigger.id, admitted: false, reason: "对局结束事件不完整(缺对局号或轮次),不立项" };
  }
  if (trigger.kind === "dropped") {
    const fileName = typeof trigger.data.fileName === "string" ? trigger.data.fileName.trim() : "";
    const complete = fileName !== "" && FILE_KINDS.includes(trigger.data.fileKind);
    return complete
      ? { triggerId: trigger.id, admitted: true, reason: "拖入文件,准予素材起草立项" }
      : { triggerId: trigger.id, admitted: false, reason: "拖入文件不完整(缺文件名或类型不识别),不立项" };
  }
  if (trigger.kind === "annotate") {
    const ticketId = typeof trigger.data.ticketId === "string" ? trigger.data.ticketId.trim() : "";
    const note = typeof trigger.data.note === "string" ? trigger.data.note.trim() : "";
    const complete = ticketId !== "" && note !== "";
    return complete
      ? { triggerId: trigger.id, admitted: true, reason: "待审批注,准予立项" }
      : { triggerId: trigger.id, admitted: false, reason: "批注不完整(缺工单号或批注内容),不立项" };
  }
  if (trigger.kind === "model-error") {
    // 报错事件本身不用带任何字段(data.error 仅备查);是否立项由放权模式研判(R5)。
    return { triggerId: trigger.id, admitted: true, reason: "模型报错,准予处置立项" };
  }
  if (trigger.kind === "research-due") {
    // 周报到期事件无需必填字段(weekId 仅归并线程用);是否立项由放权模式研判(R4)。
    return { triggerId: trigger.id, admitted: true, reason: "周报到期,准予投研立项" };
  }
  if (trigger.kind === "cards-published") {
    // 发布事件同理(materialId/cardIds 仅起草输入用);是否立项由放权模式研判(R7)。
    return { triggerId: trigger.id, admitted: true, reason: "策略卡发布,准予盲区分析立项" };
  }
  const text = typeof trigger.data.text === "string" ? trigger.data.text.trim() : "";
  if (text === "") {
    return {
      triggerId: trigger.id,
      admitted: false,
      reason: trigger.kind === "chat" ? "对话内容为空" : "命令内容为空",
    };
  }
  return {
    triggerId: trigger.id,
    admitted: true,
    reason: trigger.kind === "chat" ? "pet 对话,准予立项" : "pet 命令,准予立项",
  };
}

/** Thread 键归并(spec):对局按 gameId,周报按 weekId,发布按 materialId,pet 触发按 commandId。 */
function threadOf(trigger: AgentTrigger): AgentThread {
  if (trigger.kind === "game-ended") {
    return { kind: "gameId", key: typeof trigger.data.gameId === "string" ? trigger.data.gameId : "" };
  }
  if (trigger.kind === "research-due") {
    return { kind: "weekId", key: typeof trigger.data.weekId === "string" ? trigger.data.weekId : "" };
  }
  if (trigger.kind === "cards-published") {
    return { kind: "materialId", key: typeof trigger.data.materialId === "string" ? trigger.data.materialId : "" };
  }
  return { kind: "commandId", key: trigger.id };
}

/** spec 的五个触发来源;输入校验在进链路之前完成。 */
const SOURCES: AgentTrigger["source"][] = ["table", "materials", "research", "pet", "system"];

/**
 * 落账前剔除触发数据里的敏感字段(S4):hidden 原文是客户端私有信息,
 * 服务端既不使用也不落账——即使有人照旧传入,也在进链路前丢弃。
 * context(工单 16 的牌局快照,内含隐藏牌)只进桌宠对话 Worker 的提示词,
 * 同样不落账:见 emitTrigger 里的 ledgerTrigger。
 */
const SENSITIVE_TRIGGER_FIELDS = ["hidden"];

function sanitizeTriggerData(data: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...data };
  for (const field of SENSITIVE_TRIGGER_FIELDS) delete clean[field];
  return clean;
}

/** 账本专用视图(工单 16):在 S4 之上再剔整个 context,快照只活在本次执行里。 */
function sanitizeLedgerTriggerData(data: Record<string, unknown>): Record<string, unknown> {
  const { context: _context, ...clean } = data;
  return clean;
}

/** 每个 kind 所属的合法来源(spec 的 Source 域):事件类型不接受其他域冒名(S1)。 */
const KIND_SOURCES: Record<AgentTrigger["kind"], AgentTrigger["source"][]> = {
  command: ["pet"],
  chat: ["pet"],
  annotate: ["pet"],
  "game-ended": ["table"],
  dropped: ["materials"],
  "cards-published": ["materials"],
  "model-error": ["system"],
  "research-due": ["research"],
};

/** 触发类型白名单:pet 命令/对话 + 对局结束事件 + 拖入文件 + 待审批注(工单 07)+ 模型报错(工单 10)+ 周报到期/策略卡发布(工单 11)。 */
const TRIGGER_KINDS: AgentTrigger["kind"][] = [
  "command",
  "game-ended",
  "dropped",
  "annotate",
  "model-error",
  "chat",
  "research-due",
  "cards-published",
];

/** 拖入文件的类型白名单(工单 07):录音 / 生客画像 JSON / 角色卡。 */
const FILE_KINDS: unknown[] = ["audio", "persona", "role"];

/** 放权模式白名单(工单 08):off/observe/auto,缺省 observe(见 policy.ts)。 */
const ACCEPT_MODES: AcceptMode[] = ["off", "observe", "auto"];
