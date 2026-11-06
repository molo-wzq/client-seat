/**
 * 桌宠互动的纯函数与共享数据(工单 12/15):
 * - 快捷动作文案(QUICK_RING)与「演示」命令词;
 * - 戳一下的固定台词轮换(不调模型);
 * - 事件→表情映射(翻牌/举牌/挂断/待审)与闲置入睡阈值;
 * - 表情优先级归并(resolveExpression):九块状态谁上谁下,一处说清。
 * 台词与映射都是数据:不评价玩家(CONTEXT/ADR 0007),只撒娇、只陪看。
 * 表情类型统一用契约里的 PetEmotion(工单 15):本模块不再反向依赖 DeskPet。
 */
import type { PetEmotion } from "../shared/agent-contract";

/** 快捷动作 4 项(spec 故事 8):文案即命令文本,服务端 DemoWorker 按同一文案回脚本。 */
export const QUICK_RING = ["换个客户", "再来一局", "上局复盘", "本周投研"] as const;

/** 快捷动作(工单 10→15):回话之外还要跳转,App 按动作决定去哪个视图。 */
export type QuickRingAction = (typeof QUICK_RING)[number];

/** 空对话的 2 个开场建议(工单 15:固定芯片已删,开场之外只显示模型本轮建议动作)。 */
export const OPENING_SUGGESTIONS: readonly string[] = [
  "这周投研帮我划重点",
  "陪我看看上局哪里值得学",
];

/** 对话输入「演示」(工单 10):唤出一键演示控制条,不进 Agent 链路。 */
export const DEMO_COMMAND = "演示";

/** 一句戳台词:说什么、配什么表情。 */
export interface PokeLine {
  text: string;
  expression: PetEmotion;
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
export function reactionExpression(event: PetReactionEvent): PetEmotion | null {
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

/** resolveExpression 的入参:各路想接管表情的状态,缺省都让位。 */
export interface ExpressionInputs {
  /** 演示接管(审查 B1/工单 15):演示脚本驱动的表情,最高优先。 */
  demo?: PetEmotion | null;
  /** 正被拎着拖动。 */
  dragging?: boolean;
  /** 事件反应(短时,工单 12):翻牌/举牌/挂断。 */
  reaction?: PetEmotion | null;
  /** 戳一下的台词表情(短时)。 */
  poke?: PetEmotion | null;
  /** 对话期间的情绪覆盖:发送→think,回复到达→表情标签。 */
  chat?: PetEmotion | null;
  /** 闲置睡着了。 */
  sleepy?: boolean;
  /** 外部给的神态(App 按页面语境决定)。 */
  base: PetEmotion;
}

/**
 * 表情优先级归并(工单 15,审查 B1/S5):
 * 演示接管 > 被拎起 > 事件反应 > 戳一下 > 对话情绪 > 困了 > 正常神态。
 * 纯函数:组件只收集状态,谁上谁下在这里一处说清、单独可测。
 */
export function resolveExpression(inputs: ExpressionInputs): PetEmotion {
  if (inputs.demo) return inputs.demo;
  if (inputs.dragging) return "pout";
  if (inputs.reaction) return inputs.reaction;
  if (inputs.poke) return inputs.poke;
  if (inputs.chat) return inputs.chat;
  if (inputs.sleepy) return "sleepy";
  return inputs.base;
}

/** 闲置入睡阈值(工单 12):3 分钟没动静变 sleepy,再点一下醒来(只是表情,不推送消息)。 */
export const IDLE_SLEEP_MS = 3 * 60 * 1000;

/** 事件反应与戳台词的停留时长:表情停一下就回正常神态。 */
export const REACTION_HOLD_MS = 2400;
