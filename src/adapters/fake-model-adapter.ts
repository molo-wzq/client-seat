import { buildSeedMaterial, SEED_CARDS, SEED_TRANSCRIPT } from "../domain/seed";
import type { CopywritingPort, DialoguePort, ManagerTurnInput, ManagerTurnOutput, TranscriptAnalysis } from "../domain/ports";

/**
 * 伪实现(spec.md 测试决策):确定性脚本驱动端到端测试,
 * 也作为未配置真实模型密钥时的演示兜底。
 */
export class FakeModelAdapter implements CopywritingPort, DialoguePort {
  async analyzeTranscript(transcript: string): Promise<TranscriptAnalysis> {
    // 种子素材按原样识别;其他输入同样返回种子分析(伪实现不做真实提炼)。
    if (transcript.trim() !== SEED_TRANSCRIPT.trim()) {
      console.warn("[伪适配器] 输入与种子转写稿不一致,仍返回种子分析(仅用于演示/测试)");
    }
    const seed = buildSeedMaterial();
    return {
      analysis: seed.analysis,
      cards: SEED_CARDS.map(({ status: _status, ...card }) => card),
    };
  }

  async generateManagerTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput> {
    const customerText = input.customerText;

    // 第一轮:SC1 生客开场(自报身份→征询时机→身份依据→说清来意)。
    if (input.history.length === 0) {
      return {
        reply:
          "您好,我是咱们银行的客户经理。您现在方便简单聊两句吗?有两件和您代发账户有关的事想跟您说一下,不耽误您太久。",
        recognizedSignal: "电话刚接通,客户应答",
        currentGoal: "让客户确认这是本行客户经理的正常服务来电,愿意继续听下去",
        usedCardId: "sc-c01-1",
      };
    }

    // 客户明确要求结束:先接住,礼貌收口,不再推销。
    if (/(拜拜|再见|挂了|不用了|别打了|以后再说|先这样)/.test(customerText)) {
      return {
        reply: "好的,那先不打扰您了。之后有适合您的活动我随时联系您,再见。",
        recognizedSignal: "客户明确要求结束",
        currentGoal: "体面收口",
        shouldEnd: true,
        endReason: "客户明确要求结束,理财经理礼貌收口",
        outcomeSummary: "通话在客户要求下结束,未取得下一步承诺",
      };
    }

    // 其余轮次:SC2 只问现状,贴着回答找资金切入点(一次只问一个)。
    return {
      reply: "好的。想先了解一下,您平时除了炒股之外,在其他银行有没有做过灵活资金的配置?",
      recognizedSignal: "客户愿意继续沟通",
      currentGoal: "摸清客户资金的去向和打理习惯,找到可对比点",
      usedCardId: "sc-c01-2",
    };
  }
}
