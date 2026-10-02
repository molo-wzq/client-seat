import type { ConversationTurn } from './types';

export type CustomerIntent = 'leave' | 'hesitate' | 'continue' | 'unknown';

/** 只对明确原话提供确定性边界；其余语义仍交由对话模型处理。 */
export function customerIntent(text: string): CustomerIntent {
  const unquoted = text.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"|'[^']*'/g, '');
  let intent: CustomerIntent = 'unknown';
  for (const fragment of unquoted.split(/[，,。.!！；;\n]/)) {
    const clause = fragment.trim();
    if (!clause || /[?？]|如果|假如|要是|例如|比如|他说|她说|客户说|不是(?:说|要|想)|先别挂|不要挂|别挂|不用挂|不想挂|为什么|是不是|什么意思|挂断(?:前|后|时)|再见(?:这|的)|拜拜(?:这|的)/.test(clause)) continue;
    if (/别(?:再)?(?:给我)?(?:打电话|打(?:了|啊|吧|呀|$)|联系)|不要(?:再)?(?:给我)?(?:打电话|联系)|不用再(?:打电话|打(?:了|啊|吧|呀|$)|联系)|再见$|拜拜$|我(?:现在)?(?:要|得)?(?:先)?挂(?:了|电话)|挂断(?:吧|了|电话|$)|先这样|^(?:好了好了|好|那|我)?\s*不用了|不感兴趣|没兴趣|不想(?:再)?(?:聊|听|了解)|(?:现在|今天)(?:不方便|没空)|我(?:现在|正在|在)(?:开车|开会)/.test(clause)) {
      intent = 'leave';
    } else if (/继续(?:说|聊)|愿意(?:再)?(?:听|了解)|可以(?:再)?(?:说|讲)|你(?:先)?说|我(?:还有|想问|想了解)|还想了解/.test(clause)) {
      intent = 'continue';
    } else if (/考虑|再说|暂时不|先不用|到时候看|不怎么想/.test(clause) && intent !== 'leave') {
      intent = 'hesitate';
    }
  }
  return intent;
}

/** 当前仍连续犹豫的次数；继续交流会结束此前这一段犹豫。 */
export function consecutiveHesitations(history: ConversationTurn[], current: string): number {
  let count = customerIntent(current) === 'hesitate' ? 1 : 0;
  if (!count) return 0;
  for (const turn of [...history].reverse()) {
    if (turn.speaker !== 'customer') continue;
    if (customerIntent(turn.text) !== 'hesitate') break;
    count += 1;
  }
  return count;
}
