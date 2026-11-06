/**
 * 模型错误出口(S5):网关的原始报错可能回显密钥或请求片段,不能进
 * Report/账本/玩家气泡。对外统一分类成中文短码;原文只进服务端日志,
 * 且打日志前先掩掉形如密钥的串。
 */

/** 任意 throw 取消息:非 Error(字符串、对象等)不二次抛错。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 形如密钥的串:sk- 开头的 token 与 Bearer 凭据,打日志前替换成 ***。 */
export function maskModelSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
}

/** 分类后的中文短码:进 Report/气泡的唯一错误文案,不含任何原始响应。 */
export function classifyModelError(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("超时")) return "模型超时";
  if (/HTTP 40[13]/.test(message)) return "模型鉴权失败";
  if (/HTTP \d{3}/.test(message) || message.includes("网关")) return "模型网关错误";
  if (message.includes("返回为空")) return "模型返回为空";
  return "模型调用失败";
}
