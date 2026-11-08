import type {
  AcceptMode,
  AgentEvalRecord,
  AgentPolicy,
  AgentPolicyRule,
  AgentTrigger,
  LedgerEntry,
} from "./types";

/**
 * 放权策略(工单 08):R1–R7 是 spec v9 的主动规则,全部写成数据放在这里;
 * 核心只按 source+kind 查表,不把规则写成代码。规则命中产生 inferred 候选,
 * 归 off/observe/auto 三档处置;pet 命令是 explicit 授权,不查表、直接立项。
 */

/** 缺省放权模式:先只看它想做什么,管理员点头才 auto。 */
export const DEFAULT_ACCEPT_MODE: AcceptMode = "observe";

/**
 * 主动规则 R1–R7。R6 匹配 table + turn-ended(经理一轮落定后由对局发出),
 * 判定这一轮经理有没有问到隐藏信息。card-played / hidden-raised / hidden-revealed
 * 只驱动表情,不命中 R6。缺省放权仍是 observe:命中只记评估,不自动立项。
 */
export const POLICY_RULES: readonly AgentPolicyRule[] = [
  {
    id: "R1",
    name: "复盘一句话",
    source: "table",
    kind: "game-ended",
    wouldDo: "自动起草本局复盘一句话",
    why: "对局刚结束，趁热提炼经理哪招值得学",
  },
  {
    id: "R2",
    name: "素材入草稿",
    source: "materials",
    kind: "dropped",
    wouldDo: "把拖来的文件起草成素材草稿待人审",
    why: "新素材到手，先起草再等人审",
  },
  {
    id: "R3",
    name: "批注唤醒",
    source: "pet",
    kind: "annotate",
    wouldDo: "按批注唤醒原工单再改一版草稿",
    why: "待审卡收到批注，草稿该照改",
  },
  {
    id: "R4",
    name: "投研要点",
    source: "research",
    kind: "research-due",
    wouldDo: "通读到期的周报并整理本周要点",
    why: "周报到期，投研弹药要先备好",
  },
  {
    id: "R5",
    name: "报错处置",
    source: "system",
    kind: "model-error",
    wouldDo: "记下模型报错并安排重试",
    why: "报错会卡住工单，先落账再重试",
  },
  {
    id: "R6",
    name: "翻牌判定",
    source: "table",
    kind: "turn-ended",
    wouldDo: "判定本轮经理是否问出隐藏信息",
    why: "每轮都该替玩家核对一遍隐藏牌",
  },
  {
    id: "R7",
    name: "盲区分析",
    source: "materials",
    kind: "cards-published",
    wouldDo: "对新发布的策略卡做盲区分析",
    why: "新卡上桌，看看打法有没有盲区",
  },
];

/** 规则匹配:同一来源、同一触发类型即命中;pet 命令不走这里(explicit)。 */
export function findPolicyRule(trigger: AgentTrigger): AgentPolicyRule | undefined {
  return POLICY_RULES.find((rule) => rule.source === trigger.source && rule.kind === trigger.kind);
}

/** 初始策略:版本从 1 起,每次切换 +1(见核心 setAcceptMode)。 */
export function initialPolicy(acceptMode: AcceptMode = DEFAULT_ACCEPT_MODE): AgentPolicy {
  return { version: 1, acceptMode, rules: [...POLICY_RULES] };
}

/** 账本折叠出评估记录(evals() 每次现算):补上账本时间,顺序即命中顺序。 */
export function foldEvals(entries: LedgerEntry[]): AgentEvalRecord[] {
  return entries
    .filter((entry) => entry.type === "disposition")
    .map((entry) => ({ ...entry.disposition, at: entry.at }));
}
