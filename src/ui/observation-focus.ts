import type { ConversationResult, ObservationFocus } from "../domain/types";

export const OBSERVATION_FOCI: Array<{ id: ObservationFocus; label: string; question: string; check: string; locate?: RegExp }> = [
  { id: "signals", label: "接住顾虑", question: "经理怎样接住我的顾虑？", check: "有没有回应你具体的顾虑，再征询是否继续？还是直接推进了新话题？", locate: /担心|怕|不放心|忙|没时间|考虑|不用|不要|不需要|不想|少说|再说|不方便|别.*(?:打|联系)|挂(?:了|断|电话)|再见|拜拜|没兴趣|不感兴趣/ },
  { id: "conditions", label: "核对条件", question: "经理怎样把条件说清楚？", check: "经理有没有确认资格和需求？所说规则、取用与收益能否对照本局参数？", locate: /条件|规则|怎么|如何|收益|保证|取用|赎回|资格|风险|几天|期限|门槛|参加|报名/ },
  { id: "next-step", label: "明确下一步", question: "经理怎样争取合理的下一步？", check: "下一步是谁做什么、何时做？有没有征得你的同意，而不是把犹豫当作承诺？", locate: /下一步|什么时候|几点|明天|后天|周[一二三四五六日天]|联系|到店|过去|回头|再打|考虑|安排|帮我/ },
  { id: "free", label: "自由观察", question: "自由观察本局的沟通变化", check: "选一句让你在意的回应，对照前一条客户原话：经理接住了什么，又遗漏了什么？" },
];

export function observationFocus(id?: ObservationFocus) {
  return OBSERVATION_FOCI.find((focus) => focus.id === id) ?? OBSERVATION_FOCI[3];
}

/** 只根据客户实际原话定位核对入口,不判定经理是否达标。 */
export function observationPairs(result: ConversationResult) {
  const focus = observationFocus(result.observationFocus);
  return result.turns.flatMap((turn, index) => {
    if (turn.speaker !== "manager") return [];
    const customer = result.turns.slice(0, index).reverse().find((t) => t.speaker === "customer");
    return customer && (!focus.locate || focus.locate.test(customer.text)) ? [{ customer, manager: turn }] : [];
  });
}
