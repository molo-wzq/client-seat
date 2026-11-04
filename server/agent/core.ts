import { randomId } from "../../src/domain/ports";
import { ValidationError } from "../../src/domain/product-core";
import type {
  AgentDecision,
  AgentEvent,
  AgentReport,
  AgentTicket,
  AgentTicketView,
  AgentThread,
  AgentTrigger,
  AgentTriggerInput,
  LedgerEntry,
  PostgameBasis,
} from "./types";
import type { LedgerStorage } from "./storage";
import { foldTickets } from "./tickets";

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

/** Worker:领一张工单干活,途中可经 onReport 追加汇报,最终返回一条 Report。 */
export interface AgentWorker {
  run(ticket: AgentTicket, trigger: AgentTrigger, onReport: ReportSink): Promise<AgentReport>;
}

/**
 * 快捷环即时命令的确定性回复(工单 03):键与前端 DeskPet 快捷环的按钮文案一致,
 * 两端各自被测试钉住。口吻是客户侧搭档对玩家说话,不评价玩家,不超过 40 字。
 * 「本周投研」自工单 05 起走分步演示(推进一步后待人决定),不在此表。
 */
const QUICK_RING_REPLIES: Record<string, string> = {
  换个客户: "好，去名册挑位新客户，这就给你换上。",
  再来一局: "收到，马上重摆牌桌，再来一局。",
  上局复盘: "这就调出上局复盘，挑值得学的给你看。",
};

/** demo Worker 的可注入依赖:分步节奏的 sleep,测试换即时假钟,不真等。 */
export interface DemoWorkerDeps {
  sleep?: (ms: number) => Promise<void>;
}

/** 演示节奏:每步约三分之一秒,看得见推进又不拖沓。 */
const DEMO_STEP_MS = 350;

/**
 * demo Worker:确定性脚本,不调模型(无 key 演示路径;真实模型见工单 11)。
 * 工单 05 起支持分步演示:含「并行」或快捷命令「本周投研」时,
 * 途中追加 progress,最终就绪或停在 waiting 待人决定;「同意/驳回 [工单号]」
 * 把最近(或指定)的等待工单调回 ready/dropped——决议本身也是一张小工单。
 * 工单 06 起:对局结束事件(game-ended)由复盘脚本起草一句话。
 * 工单 07 起:拖文件到桌宠(dropped)走素材草稿脚本,停在 waiting 草稿待审。
 */
export class DemoWorker implements AgentWorker {
  private readonly sleep: (ms: number) => Promise<void>;
  /** 已抛出 waiting、还没收回决定的工单号;决议按最近优先。 */
  private waitingTicketIds: string[] = [];

  constructor(deps: DemoWorkerDeps = {}) {
    this.sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async run(ticket: AgentTicket, trigger: AgentTrigger, onReport: ReportSink): Promise<AgentReport> {
    if (trigger?.kind === "game-ended") return this.runPostgameReview(ticket, trigger);
    if (trigger?.kind === "dropped") return this.runMaterialDraft(ticket, onReport);
    if (trigger?.kind === "annotate") return this.runAnnotate(ticket, trigger, onReport);
    const text = typeof trigger?.data?.text === "string" ? trigger.data.text.trim() : "";
    // 待人决定的决议命令:「同意」「驳回」,可带工单号(待办面板按钮就这么发)。
    const decision = /^(同意|驳回)\s*(\S+)?$/.exec(text);
    if (decision) return this.runDecision(ticket, decision[1], decision[2], onReport);
    if (text === "本周投研" || text.includes("并行")) return this.runStepwiseDemo(ticket, text, onReport);
    return { ticketId: ticket.id, status: "ready", text: QUICK_RING_REPLIES[text] ?? "收到，马上办" };
  }

  /** 分步演示:先报进展,「并行」再推一步后就绪,「本周投研」停在等待拍板。 */
  private async runStepwiseDemo(
    ticket: AgentTicket,
    text: string,
    onReport: ReportSink,
  ): Promise<AgentReport> {
    await onReport({
      ticketId: ticket.id,
      status: "progress",
      text: text === "本周投研" ? "先把本周投研通读了一遍。" : "两条线并行开工，先各拆一半。",
    });
    await this.sleep(DEMO_STEP_MS);
    if (text === "本周投研") {
      this.waitingTicketIds.push(ticket.id);
      return { ticketId: ticket.id, status: "waiting", text: "本周投研先押 AI 还是消费？等你拍板。" };
    }
    await onReport({ ticketId: ticket.id, status: "progress", text: "一条线收尾，另一条过半。" });
    await this.sleep(DEMO_STEP_MS);
    return { ticketId: ticket.id, status: "ready", text: "并行的事都办完了，结果放你手边。" };
  }

  /** 决议:唤醒等待工单落 ready/dropped;找不到等待工单就直说,不误落账。 */
  private async runDecision(
    ticket: AgentTicket,
    verb: string,
    ticketId: string | undefined,
    onReport: ReportSink,
  ): Promise<AgentReport> {
    const agree = verb === "同意";
    const target =
      (ticketId !== undefined && this.waitingTicketIds.includes(ticketId) ? ticketId : undefined) ??
      this.waitingTicketIds.at(-1);
    if (target === undefined) {
      return { ticketId: ticket.id, status: "ready", text: "现在没有等你拍板的工单。" };
    }
    this.waitingTicketIds = this.waitingTicketIds.filter((id) => id !== target);
    await onReport({
      ticketId: target,
      status: agree ? "ready" : "dropped",
      text: agree ? "收到，按你拍板的出结果。" : "收到，这条不做了。",
    });
    return { ticketId: ticket.id, status: "ready", text: agree ? "好，已照办。" : "好，已驳回。" };
  }

  /**
   * 素材草稿脚本(demo,工单 07):拖来的文件分步推进 转写中→分析中→起草中,
   * 落 waiting(草稿待审)复用素材库现有的人审发布流程。demo 只带文件名与类型,
   * 不读文件内容;Worker 手里没有任何发布接口——草稿不能直接上桌。
   */
  private async runMaterialDraft(ticket: AgentTicket, onReport: ReportSink): Promise<AgentReport> {
    for (const step of ["转写中", "分析中", "起草中"]) {
      await onReport({ ticketId: ticket.id, status: "progress", text: `${step}…` });
      await this.sleep(DEMO_STEP_MS);
    }
    this.waitingTicketIds.push(ticket.id);
    return { ticketId: ticket.id, status: "waiting", text: "草稿好了，进待审，等你过目。" };
  }

  /**
   * 批注唤醒(demo,工单 07):待审卡上的批注唤醒原工单——对同一 ticketId
   * 追加 progress→waiting(按批注改过的草稿),工单继续待人决定;
   * 批注自身像决议一样是一张小工单,转达完就绪。
   */
  private async runAnnotate(
    ticket: AgentTicket,
    trigger: AgentTrigger,
    onReport: ReportSink,
  ): Promise<AgentReport> {
    const ticketId = typeof trigger.data.ticketId === "string" ? trigger.data.ticketId : "";
    if (!this.waitingTicketIds.includes(ticketId)) {
      return { ticketId: ticket.id, status: "ready", text: "没有这张待审工单。" };
    }
    await onReport({ ticketId, status: "progress", text: "按批注改草稿，改完再给你。" });
    await this.sleep(DEMO_STEP_MS);
    await onReport({ ticketId, status: "waiting", text: "草稿按批注改好了，再等你过目。" });
    return { ticketId: ticket.id, status: "ready", text: "收到，按批注改。" };
  }

  /**
   * 复盘一句话(demo 确定性脚本,工单 06):「经理哪招值得学」只评经理、不评玩家;
   * 没有值得单说的招就落 dropped(沉默,不出气泡)。
   */
  private async runPostgameReview(ticket: AgentTicket, trigger: AgentTrigger): Promise<AgentReport> {
    const gameId = typeof trigger.data.gameId === "string" ? trigger.data.gameId : "";
    const draft = draftPostgameOneLiner(gameId, parsePostgameRounds(trigger.data));
    if (!draft) {
      return { ticketId: ticket.id, status: "dropped", text: "这局没有单独值得学的招，先不多说。" };
    }
    return { ticketId: ticket.id, status: "ready", text: draft.text, basis: draft.basis };
  }
}

/** game-ended 的一轮:经理话术与该轮所用策略卡(工单 06 约定的 data 形状)。 */
interface PostgameRound {
  managerText: string;
  cardId?: string;
}

/** 从触发 data 里防御性取出轮次:形状不对的条目直接丢弃,不让脚本崩。 */
function parsePostgameRounds(data: Record<string, unknown>): PostgameRound[] {
  const rounds = Array.isArray(data.rounds) ? data.rounds : [];
  return rounds.filter(
    (round): round is PostgameRound =>
      typeof round === "object" && round !== null && typeof (round as PostgameRound).managerText === "string",
  );
}

/**
 * 复盘一句话草稿:在用过策略卡的经理轮里挑话术最实(最长)的一轮,
 * 一句话点名轮次、只评经理这一招;没有任何用卡轮 → null(无值得说的内容)。
 */
function draftPostgameOneLiner(
  gameId: string,
  rounds: PostgameRound[],
): { text: string; basis: PostgameBasis } | null {
  let best: { managerText: string; cardId: string; turnNumber: number } | null = null;
  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    if (!round || round.cardId === undefined) continue;
    if (best === null || [...round.managerText].length > [...best.managerText].length) {
      best = { managerText: round.managerText, cardId: round.cardId, turnNumber: index + 1 };
    }
  }
  if (best === null) return null;
  return {
    text: `第${best.turnNumber}轮先接住话头再往下谈，这招值得学。`,
    basis: { gameId, turnNumber: best.turnNumber, cardId: best.cardId },
  };
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
  /** 只读工单视图(工单 05):账本折叠出每张工单最新状态,不追加任何条目。 */
  tickets(): Promise<AgentTicketView[]>;
}

export function createAgentCore(deps: { storage: LedgerStorage; worker: AgentWorker }): AgentCore {
  const { storage, worker } = deps;
  const listeners = new Set<(event: AgentEvent) => void>();

  return {
    async emitTrigger(input) {
      if (!SOURCES.includes(input.source)) {
        throw new ValidationError(`触发来源不合法:${String(input.source)}`);
      }
      if (!TRIGGER_KINDS.includes(input.kind)) {
        throw new ValidationError(`触发类型不合法:${String(input.kind)}`);
      }
      const trigger: AgentTrigger = { ...input, id: randomId() };
      await storage.appendLedgerEntry({ type: "trigger", trigger });

      const decision = evaluate(trigger);
      await storage.appendLedgerEntry({ type: "decision", decision });
      if (!decision.admitted) {
        return { triggerId: trigger.id, admitted: false, ticket: null, report: null };
      }

      // Thread 键按 spec 归并:pet 命令按 commandId(本次触发的 id),
      // 对局结束事件按 gameId(本局的复盘工作都归到同一局)。
      const thread: AgentThread =
        trigger.kind === "game-ended"
          ? { kind: "gameId", key: typeof trigger.data.gameId === "string" ? trigger.data.gameId : "" }
          : { kind: "commandId", key: trigger.id };
      const ticket: AgentTicket = {
        id: randomId(),
        triggerId: trigger.id,
        thread,
      };
      await storage.appendLedgerEntry({ type: "ticket", ticket });

      // 每条 Report(途中的与最终的)走同一条出口:先落账,再发事件;能说的才配气泡。
      const emitReport = async (report: AgentReport): Promise<void> => {
        await storage.appendLedgerEntry({ type: "report", report });
        publish({ type: "report", report });
        // dropped 的语义是沉默(spec 故事 7:没什么值得说就保持沉默):
        // 账本与工单视图照记「已放弃」,但不推气泡。
        if (report.status === "dropped") return;
        publish({
          type: "channel",
          // 桌宠气泡硬上限 40 字(spec);Report 原文完整留在账本里。
          channel: { target: "pet-bubble", ticketId: report.ticketId, text: [...report.text].slice(0, 40).join("") },
        });
      };
      const report: AgentReport = { ...(await worker.run(ticket, trigger, emitReport)), ticketId: ticket.id };
      await emitReport(report);

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
  };

  function publish(event: AgentEvent): void {
    for (const listener of listeners) listener(event);
  }
}

/** Eval:本期只做准入——pet 命令须带非空文本,对局结束事件须带对局号与轮次,拖入文件须带文件名与合法类型;研判与放权模式见后续票。 */
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
  const text = typeof trigger.data.text === "string" ? trigger.data.text.trim() : "";
  if (text === "") return { triggerId: trigger.id, admitted: false, reason: "命令内容为空" };
  return { triggerId: trigger.id, admitted: true, reason: "pet 命令,准予立项" };
}

/** spec 的五个触发来源;输入校验在进链路之前完成。 */
const SOURCES: AgentTrigger["source"][] = ["table", "materials", "research", "pet", "system"];

/** 触发类型白名单:pet 命令 + 对局结束事件 + 拖入文件 + 待审批注(工单 07)。 */
const TRIGGER_KINDS: AgentTrigger["kind"][] = ["command", "game-ended", "dropped", "annotate"];

/** 拖入文件的类型白名单(工单 07):录音 / 生客画像 JSON / 角色卡。 */
const FILE_KINDS: unknown[] = ["audio", "persona", "role"];
