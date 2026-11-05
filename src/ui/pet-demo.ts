/**
 * 一键演示脚本(工单 10,spec 故事 15):7 幕 beats 写成纯数据,
 * 由纯函数状态机推进(下一步/暂停/重置/越界钳制),演示控制条只负责解释执行。
 * 全程只发真实 Trigger 走真实链路(Source→Eval→Ticket→Worker→Report→Channel),
 * 不依赖任何真实模型——汇报时无 key 也能完整跑通。
 */
import type { AcceptMode, AgentTriggerInput } from "../../server/agent/types";
import type { ConversationTurn, StrategyCard } from "../domain/types";
import type { PetExpression } from "./DeskPet";

/** 演示舞台场景:控制条旁的小舞台显示什么(隐藏牌/结算由真实组件渲染)。 */
export type DemoScene = "table" | "hidden-cards" | "settle" | "none";

/** 舞台外焦点:让 App 打开桌宠的哪个面板(对话面板/工单列表/待办面板)。 */
export type DemoFocusPanel = "chat" | "tickets" | "inbox" | "none";

/**
 * 一步内要执行的动作(数据,不是函数):控制条按 kind 解释——
 * pet 换桌宠表情、manager-move 台账加一条经理出招、command/trigger 发真实触发、
 * chat 让 App 代玩家在对话面板发一句(工单 12)、annotate-last-drop 批注上一张拖入工单、
 * policy 切放权、focus 开面板、scene 换舞台。
 */
export type DemoAction =
  | { kind: "pet"; expression: PetExpression }
  | {
      kind: "manager-move";
      /** 经理(或客户)这一招的原话,舞台上展示。 */
      move: string;
      /** 该轮所用策略卡名(牌桌语境);客户发言没有。 */
      cardName?: string;
      /** 桌宠反应表情(最贴近的素材)。 */
      reaction: PetExpression;
      /** 反应的名字(spec 故事 3:点头/鼓腮/惊讶)。 */
      reactionLabel: string;
    }
  | { kind: "command"; text: string }
  /** 对话面板代发(工单 12):如同玩家亲手输入,回复逐字流回面板。 */
  | { kind: "chat"; text: string }
  | { kind: "trigger"; input: AgentTriggerInput }
  | { kind: "annotate-last-drop"; note: string }
  | { kind: "policy"; mode: AcceptMode }
  | { kind: "focus"; panel: DemoFocusPanel }
  | { kind: "scene"; scene: DemoScene };

/** 一拍演示:属于哪一幕、一句说明、自动播放时停留多久、进入时执行哪些动作。 */
export interface DemoStep {
  /** 幕号 1–7,对应验收的 ①–⑦。 */
  act: number;
  /** 控制条上的一句步骤说明(给汇报人念的)。 */
  note: string;
  /** 自动播放的停留毫秒;缺省用 DEFAULT_HOLD_MS。 */
  holdMs?: number;
  actions: readonly DemoAction[];
}

/** 自动播放每拍缺省停留:够看清一拍,又不拖沓。 */
export const DEFAULT_HOLD_MS = 2400;

/* ---- 第②/③/④幕共用的演示对局数据(纯前端 demo 牌局,不进任何经理会话) ---- */

/** 演示对局号(game-ended 触发与复盘依据用它对上)。 */
export const DEMO_GAME_ID = "demo-2026-w44";

/** 演示生客的三张隐藏牌:①自动翻 ②举牌 ③整局没碰。 */
export const DEMO_HIDDEN_ITEMS: readonly string[] = [
  "孩子出国留学要换外汇",
  "季度奖金到账，还没存定期",
  "老房子的房贷利率想转",
];

/** 演示策略卡(隐藏牌归因标注用;与真实策略卡同一形状)。 */
export const DEMO_CARDS: readonly StrategyCard[] = [
  {
    id: "c-jiekua",
    name: "接话头",
    status: "published",
    sourceExcerpt: { materialTitle: "合成演示素材", turnRange: "T01–T02" },
    triggerSignals: ["客户接住话头"],
    applicableScenario: "开场寒暄",
    currentPurpose: "建立身份可信度",
    actionChain: ["先接话头再往下谈"],
    expressionPrinciples: ["口语、短句"],
    referenceScripts: ["您先说,我听着"],
    applicableConditions: ["客户在寒暄"],
    stopConditions: ["客户明确离场"],
  },
  {
    id: "c-window",
    name: "钱有窗口",
    status: "published",
    sourceExcerpt: { materialTitle: "合成演示素材", turnRange: "T03–T04" },
    triggerSignals: ["客户提到在意的资金"],
    applicableScenario: "资金安排话题",
    currentPurpose: "了解必要需求",
    actionChain: ["点出资金窗口,给台阶"],
    expressionPrinciples: ["不催促"],
    referenceScripts: ["这笔钱放着也可惜"],
    applicableConditions: ["客户提到具体资金"],
    stopConditions: ["客户回避资金话题"],
  },
];

/** 演示对局轮次:第 1 轮经理用『钱有窗口』问到季度奖(举牌),第 2 轮客户说出外汇(自动翻)。 */
export const DEMO_TURNS: readonly ConversationTurn[] = [
  { number: 1, speaker: "customer", text: "王经理，忙啥呢。" },
  { number: 2, speaker: "manager", text: "您那笔季度奖到账了吧？放活期可惜了。", usedCardId: "c-window" },
  { number: 3, speaker: "customer", text: "孩子出国留学的学费，得换些外汇。" },
  { number: 4, speaker: "manager", text: "外汇我熟，回头给您出个方案。", usedCardId: "c-jiekua" },
];

/** 结算复盘触发(第④幕):轮次取演示对局的经理轮,与服务端复盘脚本同一形状。 */
function demoGameEndedInput(): AgentTriggerInput {
  const rounds = DEMO_TURNS.filter((turn) => turn.speaker === "manager").map((turn) => ({
    managerText: turn.text,
    ...(turn.usedCardId ? { cardId: turn.usedCardId } : {}),
  }));
  return {
    source: "table",
    kind: "game-ended",
    data: { gameId: DEMO_GAME_ID, rounds, hiddenUnrevealedCount: 2 },
  };
}

/* ---- 7 幕演示脚本(数据) ---- */

export const DEMO_STEPS: readonly DemoStep[] = [
  // ① 桌宠挥手入场
  { act: 1, note: "第①幕·入场:桌宠挥挥手,在客户席坐下", holdMs: 1600, actions: [{ kind: "pet", expression: "wave" }, { kind: "scene", scene: "none" }] },
  { act: 1, note: "打个招呼——点开对话面板,回复逐字流出、表情跟着换", holdMs: 3600, actions: [
    { kind: "focus", panel: "chat" },
    { kind: "chat", text: "小贝，跟观众打个招呼" },
  ] },
  // ② 陪看对局:经理出招,桌宠只用表情回应(spec 故事 3,不说话)
  { act: 2, note: "第②幕·陪看:经理用『钱有窗口』问季度奖,桌宠点头", holdMs: 2400, actions: [
    { kind: "scene", scene: "table" },
    { kind: "manager-move", move: "王经理：您那笔季度奖到账了吧？放活期可惜了。", cardName: "钱有窗口", reaction: "wave", reactionLabel: "点头" },
  ] },
  { act: 2, note: "经理连推产品、节奏太急——桌宠鼓腮", holdMs: 2400, actions: [
    { kind: "manager-move", move: "这款现在买最划算，额度不多，我给您留一份？", reaction: "pout", reactionLabel: "鼓腮" },
  ] },
  { act: 2, note: "客户说出孩子留学要换外汇——桌宠惊讶:新信号!", holdMs: 2400, actions: [
    { kind: "manager-move", move: "客户：孩子出国留学的学费，得换些外汇。", reaction: "think", reactionLabel: "惊讶" },
  ] },
  // ③ 隐藏牌:一张自动翻开,一张举牌等玩家
  { act: 3, note: "第③幕·隐藏牌:说出口的信号自动翻开,标注轮次与用卡", holdMs: 2600, actions: [{ kind: "scene", scene: "hidden-cards" }] },
  { act: 3, note: "问到边上的这张举牌,等你点「翻」或「先藏着」", holdMs: 3200, actions: [] },
  // ④ 结算揭晓 + 复盘一句话
  { act: 4, note: "第④幕·结算:扣着的牌全部揭晓,漏的信号只说经理", holdMs: 2600, actions: [{ kind: "scene", scene: "settle" }] },
  { act: 4, note: "复盘一句话:只评经理哪招值得学(真实 game-ended 触发)", holdMs: 2600, actions: [
    { kind: "pet", expression: "cheer" },
    { kind: "trigger", input: demoGameEndedInput() },
  ] },
  // ⑤ 命令条一句话并行开 3 张工单
  { act: 5, note: "第⑤幕·一句话并行:三张工单同时开工(工单列表已打开)", holdMs: 3000, actions: [
    { kind: "focus", panel: "tickets" },
    { kind: "scene", scene: "none" },
    { kind: "command", text: "并行：整理王姐素材要点" },
    { kind: "command", text: "并行：提炼上局复盘" },
    { kind: "command", text: "并行：总结本周投研" },
  ] },
  { act: 5, note: "三条线在工单列表里同时推进,桌宠照常回话", holdMs: 2600, actions: [] },
  // ⑥ 拖入素材→待审→批注续改
  { act: 6, note: "第⑥幕·拖给它:一段录音拖到桌宠身上,转写→分析→起草", holdMs: 3000, actions: [
    { kind: "trigger", input: { source: "materials", kind: "dropped", data: { fileName: "王姐通话.mp3", fileKind: "audio" } } },
  ] },
  { act: 6, note: "草稿进待审、角标亮了;写句批注,原工单接着改", holdMs: 3000, actions: [
    { kind: "focus", panel: "inbox" },
    { kind: "annotate-last-drop", note: "开头一句改得口语一点" },
  ] },
  // ⑦ 放权模式 + 评估记录 + Watchdog 标受阻
  { act: 7, note: "第⑦幕·放权:从「观察」切到「自动」", holdMs: 2400, actions: [
    { kind: "policy", mode: "auto" },
    { kind: "focus", panel: "inbox" },
  ] },
  { act: 7, note: "评估记录留痕:本来会做什么、为什么;observe 只记录、auto 已执行", holdMs: 2600, actions: [] },
  { act: 7, note: "模型报错→重试无果,Watchdog 标受阻进待办,不打扰玩家", holdMs: 3000, actions: [
    { kind: "trigger", input: { source: "system", kind: "model-error", data: { error: "演示:模型超时" } } },
  ] },
  { act: 7, note: "演示完毕:桌宠不评价你,只陪你看局、替你跑腿", holdMs: 1600, actions: [
    { kind: "pet", expression: "cheer" },
    { kind: "focus", panel: "none" },
  ] },
];

/* ---- 演示状态机(纯函数;越界钳制,演完自动停) ---- */

/** 演示进度:index 是当前步(0 起),等于总步数表示演完。 */
export interface DemoState {
  index: number;
  playing: boolean;
}

export function initialDemoState(): DemoState {
  return { index: 0, playing: false };
}

/** 当前步的数据;演完(越界)返回 null。 */
export function currentDemoStep(state: DemoState): DemoStep | null {
  return DEMO_STEPS[state.index] ?? null;
}

/** 手动下一步:演完后再按停在原地,不放出来。 */
export function stepDemo(state: DemoState): DemoState {
  const index = Math.min(state.index + 1, DEMO_STEPS.length);
  // 走到总步数即演完:自动播放一并停下(播放计时器随之清掉)。
  return { index, playing: index >= DEMO_STEPS.length ? false : state.playing };
}

/** 播放:未演完才续播;演完保持演完态(重置后再播)。 */
export function playDemo(state: DemoState): DemoState {
  if (state.index >= DEMO_STEPS.length) return state;
  return { ...state, playing: true };
}

/** 暂停:停在当前步。 */
export function pauseDemo(state: DemoState): DemoState {
  return { ...state, playing: false };
}

/** 重置:回到第 1 步并停播(舞台状态由控制条一并还原)。 */
export function resetDemo(state: DemoState): DemoState {
  return initialDemoState();
}
