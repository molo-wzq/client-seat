import type { AgentWorker, WorkerContext, WorkerRunOptions } from "../core";
import type { AgentReport, AgentTicket, AgentTrigger, PetEmotion, PostgameBasis } from "../types";

/**
 * demo Worker:确定性脚本,不调模型(无 key 演示路径;真实模型见 workers.ts)。
 * 工单 05 起支持分步演示:含「并行」或快捷命令「本周投研」时,
 * 途中追加 progress,最终就绪或停在 waiting 待人决定;「同意/驳回 [工单号]」
 * 把最近(或指定)的等待工单调回 ready/dropped——决议本身也是一张小工单。
 * 工单 06 起:对局结束事件(game-ended)由复盘脚本起草一句话。
 * 工单 07 起:拖文件到桌宠(dropped)走素材草稿脚本,停在 waiting 草稿待审。
 * 工单 16 起:牌局事件(经理出卡/隐藏牌被问到/玩家揭示)落成带表情的
 * dropped Report——对局中不说话,只用表情(spec 故事 3),前端据此驱动微反应。
 */

/** 牌局事件(工单 16):是否桌上的反应类触发。 */
export function isTableReaction(kind: AgentTrigger["kind"] | undefined): kind is "card-played" | "hidden-raised" | "hidden-revealed" {
  return kind === "card-played" || kind === "hidden-raised" || kind === "hidden-revealed";
}

/** 牌局事件 → 表情(工单 16):出招看局、被问到边上鼓腮、玩家翻牌欢呼。 */
export function tableReactionEmotion(kind: "card-played" | "hidden-raised" | "hidden-revealed"): PetEmotion {
  if (kind === "card-played") return "think";
  if (kind === "hidden-raised") return "pout";
  return "cheer";
}

/** 反应 Report:一律 dropped(沉默,不出气泡),表情走结构化字段。 */
function runTableReaction(ticket: AgentTicket, kind: "card-played" | "hidden-raised" | "hidden-revealed"): AgentReport {
  return {
    ticketId: ticket.id,
    status: "dropped",
    text: "看在眼里,不说话。",
    emotion: tableReactionEmotion(kind),
  };
}

/**
 * 即时命令的确定性回复:键与前端 DeskPet 快捷环的按钮文案一致(工单 03),
 * 两端各自被测试钉住;工单 10 另收演示脚本的口令。口吻是客户侧搭档对玩家说话,
 * 不评价玩家,不超过 40 字。「本周投研」自工单 05 起走分步演示(推进一步后待人决定),不在此表。
 */
const SCRIPTED_REPLIES: Record<string, string> = {
  换个客户: "好，去名册挑位新客户，这就给你换上。",
  再来一局: "收到，马上重摆牌桌，再来一局。",
  上局复盘: "这就调出上局复盘，挑值得学的给你看。",
  跟观众打个招呼: "大家好，我坐这儿陪你看完这局。",
};

/** demo Worker 的可注入依赖:分步节奏的 sleep,测试换即时假钟,不真等。 */
export interface DemoWorkerDeps {
  sleep?: (ms: number) => Promise<void>;
}

/** 演示节奏:每步约三分之一秒,看得见推进又不拖沓。 */
const DEMO_STEP_MS = 350;

export class DemoWorker implements AgentWorker {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: DemoWorkerDeps = {}) {
    this.sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async run(ticket: AgentTicket, trigger: AgentTrigger, options: WorkerRunOptions): Promise<AgentReport> {
    const { onReport, context = { tickets: async () => [] } } = options;
    if (trigger?.kind === "game-ended") return this.runPostgameReview(ticket, trigger);
    if (isTableReaction(trigger?.kind)) return runTableReaction(ticket, trigger.kind);
    if (trigger?.kind === "dropped") return this.runMaterialDraft(ticket, onReport);
    if (trigger?.kind === "annotate") return this.runAnnotate(ticket, trigger, onReport, context);
    if (trigger?.kind === "model-error") return this.runModelError(ticket, onReport);
    const text = typeof trigger?.data?.text === "string" ? trigger.data.text.trim() : "";
    // 待人决定的决议命令:「同意」「驳回」,可带工单号与理由(工单 16;生产路径
    // 由 createModelWorkers 的审批 Worker 接管,这里是纯 demo 兜底的同一口径)。
    const decision = /^(同意|驳回)\s*(\S+)?(?:\s+(.+))?$/.exec(text);
    if (decision) return this.runDecision(ticket, decision[1], decision[2], decision[3], onReport, context);
    if (text === "本周投研" || text.includes("并行")) return this.runStepwiseDemo(ticket, text, onReport);
    return { ticketId: ticket.id, status: "ready", text: SCRIPTED_REPLIES[text] ?? "收到，马上办" };
  }

  /** 分步演示:先报进展,「并行」再推一步后就绪,「本周投研」停在等待拍板。 */
  private async runStepwiseDemo(
    ticket: AgentTicket,
    text: string,
    onReport: (report: AgentReport) => Promise<void>,
  ): Promise<AgentReport> {
    // 「并行：xxx」把任务名带进进展文案(工单 10 演示三线并行,各自看得见是谁在跑);
    // 没有冒号格式的旧命令沿用通用文案。
    const task = text.split("并行：").at(-1)?.trim();
    await onReport({
      ticketId: ticket.id,
      status: "progress",
      text: text === "本周投研"
        ? "先把本周投研通读了一遍。"
        : task
          ? `「${task}」这条线开工，先拆一半。`
          : "两条线并行开工，先各拆一半。",
    });
    await this.sleep(DEMO_STEP_MS);
    if (text === "本周投研") {
      return { ticketId: ticket.id, status: "waiting", text: "本周投研先押 AI 还是消费？等你拍板。" };
    }
    await onReport({
      ticketId: ticket.id,
      status: "progress",
      text: task ? `「${task}」过半了，快收尾。` : "一条线收尾，另一条过半。",
    });
    await this.sleep(DEMO_STEP_MS);
    return { ticketId: ticket.id, status: "ready", text: "并行的事都办完了，结果放你手边。" };
  }

  /**
   * 模型报错处置(demo,工单 10):压缩演示 Watchdog 的完整时序——先报进展(重试中),
   * 再落 blocked 带原因进待办;文案与 Watchdog 真实汇报同一口径,不出桌宠气泡
   * (spec 故事 16:不对玩家说话;真实超时路径见 watchdog.ts,阈值可经 env 调短)。
   */
  private async runModelError(ticket: AgentTicket, onReport: (report: AgentReport) => Promise<void>): Promise<AgentReport> {
    await onReport({ ticketId: ticket.id, status: "progress", text: "记下模型报错，安排重试…" });
    await this.sleep(DEMO_STEP_MS);
    return { ticketId: ticket.id, status: "blocked", text: "重试一次仍卡住，先标受阻，等你在待办里处理。" };
  }

  /** 决议:唤醒等待工单落 ready/dropped;找不到等待工单就直说,不误落账。驳回理由进归档文案。 */
  private async runDecision(
    ticket: AgentTicket,
    verb: string,
    ticketId: string | undefined,
    reason: string | undefined,
    onReport: (report: AgentReport) => Promise<void>,
    context: WorkerContext,
  ): Promise<AgentReport> {
    const agree = verb === "同意";
    const waiting = (await context.tickets()).filter((view) => view.status === "waiting");
    // 显式 ID 失效时不可审批另一张工单；只有省略 ID 才取最近待办。
    const target = ticketId === undefined
      ? waiting.at(-1)?.ticketId
      : waiting.find((view) => view.ticketId === ticketId)?.ticketId;
    if (target === undefined) {
      return { ticketId: ticket.id, status: "ready", text: "现在没有等你拍板的工单。" };
    }
    await onReport({
      ticketId: target,
      status: agree ? "ready" : "dropped",
      text: agree ? "收到，按你拍板的出结果。" : `草稿已归档。理由:${reason ?? "未说明"}`,
    });
    return { ticketId: ticket.id, status: "ready", text: agree ? "好，已照办。" : "好，已驳回。" };
  }

  /**
   * 素材草稿脚本(demo,工单 07):拖来的文件分步推进 转写中→分析中→起草中,
   * 落 waiting(草稿待审)复用素材库现有的人审发布流程。demo 只带文件名与类型,
   * 不读文件内容;Worker 手上没有任何发布接口——草稿不能直接上桌。
   */
  private async runMaterialDraft(ticket: AgentTicket, onReport: (report: AgentReport) => Promise<void>): Promise<AgentReport> {
    for (const step of ["转写中", "分析中", "起草中"]) {
      await onReport({ ticketId: ticket.id, status: "progress", text: `${step}…` });
      await this.sleep(DEMO_STEP_MS);
    }
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
    onReport: (report: AgentReport) => Promise<void>,
    context: WorkerContext,
  ): Promise<AgentReport> {
    const ticketId = typeof trigger.data.ticketId === "string" ? trigger.data.ticketId : "";
    if (!(await context.tickets()).some((view) => view.ticketId === ticketId && view.status === "waiting")) {
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
    // 工单 16:结算的「欢呼」表情由 Report 携带(不再靠外部 prop 切换)。
    return { ticketId: ticket.id, status: "ready", text: draft.text, basis: draft.basis, emotion: "cheer" };
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
