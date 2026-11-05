/**
 * 桌宠互动的纯函数与共享数据(工单 12):
 * - 快捷芯片(原快捷环收进对话面板顶部)与「演示」命令词;
 * - 戳一下的固定台词轮换(不调模型);
 * - 事件→表情映射(翻牌/举牌/挂断/待审)与闲置入睡阈值。
 * 台词与映射都是数据:不评价玩家(CONTEXT/ADR 0007),只撒娇、只陪看。
 */
import type { PetExpression } from "./DeskPet";

/** 快捷芯片 4 项(spec 故事 8):文案即命令文本,服务端 DemoWorker 按同一文案回脚本。 */
export const QUICK_RING: readonly string[] = ["换个客户", "再来一局", "上局复盘", "本周投研"];

/** 快捷芯片动作(工单 10→12):回话之外还要跳转,App 按动作决定去哪个视图。 */
export type QuickRingAction = (typeof QUICK_RING)[number];

/** 对话输入「演示」(工单 10):唤出一键演示控制条,不进 Agent 链路。 */
export const DEMO_COMMAND = "演示";

/** 一句戳台词:说什么、配什么表情。 */
export interface PokeLine {
  text: string;
  expression: PetExpression;
}

/** 戳一下的固定台词(工单 12):轮换回一句,不调模型;只撒娇,不评价玩家。 */
export const POKE_LINES: readonly PokeLine[] = [
  { text: "干嘛戳我！", expression: "pout" },
  { text: "再戳就要收费啦。", expression: "cheer" },
  { text: "痒痒的，别闹～", expression: "wave" },
  { text: "…在呢在呢，说正事。", expression: "think" },
];

/** 戳台词轮换:按戳的次数取模循环,次数由调用方递增。 */
export function pokeLine(pokeCount: number): PokeLine {
  return POKE_LINES[pokeCount % POKE_LINES.length]!;
}

/** 桌宠会反应的事件(工单 12 互动感):由 App/DeskPet 从真实交互里发出。 */
export type PetReactionEvent =
  | { kind: "hidden-revealed" } // 玩家点了「翻」:翻开隐藏牌
  | { kind: "hidden-raised" } // 经理问到边上:举牌
  | { kind: "call-ended" } // 挂断/对局结束
  | { kind: "todo-arrived" }; // 收到待人决定的待审

/**
 * 事件→表情映射(工单 12):翻牌→cheer、举牌→think、挂断→wave;
 * 待审不换表情(只晃角标),返回 null。
 */
export function reactionExpression(event: PetReactionEvent): PetExpression | null {
  switch (event.kind) {
    case "hidden-revealed":
      return "cheer";
    case "hidden-raised":
      return "think";
    case "call-ended":
      return "wave";
    case "todo-arrived":
      return null;
  }
}

/** 闲置入睡阈值(工单 12):3 分钟没动静变 sleepy,再点一下醒来(只是表情,不推送消息)。 */
export const IDLE_SLEEP_MS = 3 * 60 * 1000;

/** 事件反应与戳台词的停留时长:表情停一下就回正常神态。 */
export const REACTION_HOLD_MS = 2400;
