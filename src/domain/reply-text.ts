/**
 * 话术文本的确定性处理:只做结构与已知规则的判断,不做内容语义判断。
 * cleanReplyText 原在适配器层,复盘/流式上屏同样需要,移入领域共享。
 */

/**
 * 话术净化:模型偶发在开头带「理财经理:」称谓前缀、包裹引号、首尾空白,
 * 或在话术尾部另起一行替客户续写对话(user嗯/客户:…)——这些不是电话里
 * 说出来的话,落库与上屏共用同一清理,保证前后一致。
 * 续写只剥行首角色标记起的尾部:user/assistant 允许无冒号(实测网关形态),
 * 客户/经理要求带冒号,避免误伤句中同词。
 * 舞台指示与斜杠称呼同理不是可播出的口语:(语气温和)(笑) 整体剥除;
 * 「先生/女士」是模型没选定称呼的占位形态,剥掉后自然落到后面的称呼语。
 */
export function cleanReplyText(reply: string): string {
  return reply
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/先生\s*\/\s*女士|女士\s*\/\s*先生/g, "")
    .replace(/^(?:理财经理|经理|AI|客服|话术)\s*[:：]\s*/, "")
    .replace(
      /\n[ \t]*(?:user|assistant)[^\n]*$|\n[ \t]*(?:客户|经理|理财经理)\s*[:：][^\n]*$/i,
      "",
    )
    .replace(/^["「『“]+|["」』”]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 经理话术是否以告别收口(已知规则的确定性检查):
 * 只看**最后一句**是否含明确的告别/收口用语,避免客户反问、否定
 * (「不是要挂了」)或话术中途提到打扰造成误判。语义不在此判断。
 */
export function detectManagerFarewell(reply: string): boolean {
  const sentences = reply
    .split(/[。!！?？…\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const last = sentences.at(-1);
  if (!last) return false;
  return /拜拜|再见|不再打扰|先不打扰/.test(last);
}
