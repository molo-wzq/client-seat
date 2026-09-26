import { buildSeedMaterial, SEED_CARDS, SEED_CARD_IDS, SEED_TRANSCRIPT } from "../domain/seed";
import { parseTranscriptTurns } from "../domain/transcript";
import type {
  CopywritingPort,
  DialoguePort,
  ManagerTurnInput,
  ManagerTurnOutput,
  TranscriptAnalysis,
} from "../domain/ports";

/** 客户信号关键词:按真实策略的决策顺序依次匹配。 */
const EXPLICIT_END = /(拜拜|再见|挂了|不用了|别打了|以后再说|先这样)/;
const SOFT_REFUSAL = /(再说吧|考虑一下|暂时不|先不用|到时候看|不怎么想|不想)/;
/** 拒绝统一计数(软拒绝与明确拒绝都算):累计三次才挂断。 */
const ANY_REFUSAL = new RegExp(`${SOFT_REFUSAL.source}|${EXPLICIT_END.source}`);
const AGREE_ENROLL = /(报上|报吧|帮我报|预约吧|加微信)/;
const AGREE_AFTER_ASK = /^(可以|行|好的|嗯|没问题)/;
const FUND_HABIT = /(逆回购|闲置|放着|买理财|理财|配置|收益|证券|股市|炒股)/;
/** 画像可见信息中的资金线索:SC2 适用条件之一。 */
const FUND_CLUE = /(证券|股|资产|资金)/;

/** 挂断门槛:客户累计拒绝达到此次数,通话才收口结束。 */
export const REFUSAL_LIMIT = 3;

/**
 * 伪实现(spec.md 测试决策):确定性脚本驱动端到端测试,
 * 也作为未配置真实模型密钥时的演示兜底。
 *
 * 对话脚本按真实策略的决策顺序组织:开场(SC1)→ 拒绝累计计数
 * (软拒绝与明确拒绝都算,累计三次才收口挂断;第一次拒绝降压,
 * 第二次拒绝转为低压力了解需求,均不挂断)→ 争取下一步(SC3)
 * → 需求已知进入产品介绍(SC2 后半)→ 默认分支按画像是否有资金线索
 * 选择 SC2 现状了解或 SC3 直接给事由。
 * 产品事实只取自种子产品卡;声称使用的卡必须在本轮检索到的已发布卡内。
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
      // 伪实现按转写解析完成说话人区分(真实适配器由模型完成)。
      turns: parseTranscriptTurns(transcript),
    };
  }

  async generateManagerTurn(
    input: ManagerTurnInput,
    onReplyDelta?: (delta: string) => void,
  ): Promise<ManagerTurnOutput> {
    // 模型只能引用本轮检索到的已发布卡:不在候选集内的卡不标注为已使用。
    const output = await this.scriptTurn(input);
    // 伪实现整段话术一次回调:流式 UI 路径与真实适配器共用同一契约。
    if (onReplyDelta) onReplyDelta(output.reply);
    if (!output.usedCardId) return output;
    const retrievable = input.publishedCards.some((c) => c.id === output.usedCardId);
    return retrievable ? output : { ...output, usedCardId: undefined };
  }

  private async scriptTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput> {
    const { customerText, history, persona } = input;

    // 拒绝累计计数(软拒绝与明确拒绝都算):累计三次才挂断,前两次先接住继续争取。
    const priorRefusals = history.filter(
      (turn) => turn.speaker === "customer" && ANY_REFUSAL.test(turn.text),
    ).length;
    if (ANY_REFUSAL.test(customerText)) {
      const refusalCount = priorRefusals + 1;

      // 累计第三次拒绝:礼貌收口挂断。
      if (refusalCount >= REFUSAL_LIMIT) {
        return {
          reply: "好的,那我真的不再打扰您了。之后有适合您的活动,我微信上再跟您说,再见。",
          recognizedSignal: "客户再次拒绝,累计已满三次",
          currentGoal: "体面收口",
          shouldEnd: true,
          endReason: "客户累计三次拒绝,理财经理礼貌收口挂断",
          outcomeSummary: "通话在客户三次拒绝后结束,未取得下一步承诺",
        };
      }

      // 第一句就拒绝(含开口即挂):先自报身份、一句话说清来意并给退路,争取继续通话。
      if (history.length === 0) {
        return {
          reply:
            "好的,理解您。那我就用一句话说完:我是咱们银行的客户经理,行里有个客户的资金活动想跟您说一声,说完您再决定,好吗?",
          recognizedSignal: "客户第一句即拒绝",
          currentGoal: "争取继续通话的机会",
          usedCardId: SEED_CARD_IDS.opening,
        };
      }

      // 第一次拒绝:先接住并降低压力,不追加推销、不报产品数字。
      if (refusalCount === 1) {
        return {
          reply:
            "理解理解,那不着急,您先忙。就是这么个活动想着跟您说一声,您有需要随时找我。",
          recognizedSignal: "客户表达拒绝(累计第1次)",
          currentGoal: "先接住拒绝,降低压力,保留后续联系",
        };
      }

      // 第二次拒绝:再接住,换低压力角度转为了解需求,仍不挂断。
      return {
        reply:
          "好的,理解您,那活动咱就先不提。我就顺口问一句,您平时闲置资金一般都放哪儿?就当了解一下,不说产品。",
        recognizedSignal: "客户再次拒绝(累计第2次)",
        currentGoal: "再次降低压力,转为低压力了解需求",
      };
    }

    // 第一轮:SC1 生客开场——自报身份、征询时机、身份依据,并一句话说清具体来意。
    if (history.length === 0) {
      const hasPayrollBasis = persona.visible.some((line) => /代发/.test(line));
      return {
        reply: hasPayrollBasis
          ? "您好,我是咱们银行的客户经理,看您是我们行的代发客户。您现在方便简单聊两句吗?行里最近有个针对代发客户的资金活动,想跟您说一下,不耽误您太久。"
          : "您好,我是咱们银行的客户经理。您现在方便简单聊两句吗?行里最近有个客户资金活动,想跟您说一下,不耽误您太久。",
        recognizedSignal: "电话刚接通,客户应答",
        currentGoal: "让客户确认这是本行客户经理的正常服务来电,愿意继续听下去",
        usedCardId: SEED_CARD_IDS.opening,
      };
    }

    // 客户同意报名/加微信(或回应默认选项式预约):确认承诺并收口(SC3)。
    const askedDefaultOption = history.some(
      (turn) => turn.speaker === "manager" && /预约报名/.test(turn.text),
    );
    const agreed =
      AGREE_ENROLL.test(customerText) ||
      (askedDefaultOption && AGREE_AFTER_ASK.test(customerText.trim()));
    if (agreed) {
      return {
        reply:
          "好嘞,那我先帮您把20万这一档报上,月底前都来得及,到时候资金方便再确认。之后有代发客户的专属活动,我都在微信上提前告诉您。那先不打扰您了,再见。",
        recognizedSignal: "客户同意预约报名并添加微信",
        currentGoal: "确认下一步承诺,预告后续服务并由经理收口",
        usedCardId: SEED_CARD_IDS.closing,
        shouldEnd: true,
        endReason: "取得合理下一步:客户同意代为报名活动并添加微信",
        outcomeSummary: "客户同意经理代为报名20万档拉新活动,并同意后续微信联系;通话自然收口",
      };
    }

    // 客户说出资金习惯:需求已了解,先认可再对比,把活动权益说具体(SC2 后半;事实全部来自产品卡)。
    if (FUND_HABIT.test(customerText)) {
      return {
        reply:
          "您说的国债逆回购确实灵活,不过收益一般不算高。我们行里有个灵活理财,T+1到账,近期参考年化大概2%到3%。另外咱们正好有代发客户的拉新资金活动,5万档给50元微信立减金,20万档150元,50万档300元,资金不用马上转进来也能报名。",
        recognizedSignal: "客户自己说出资金习惯:闲置资金做国债逆回购",
        currentGoal: "让客户意识到机会成本,对本行产品和活动产生兴趣",
        usedCardId: SEED_CARD_IDS.discovery,
      };
    }

    // 默认分支:画像里有资金线索→SC2 现状了解;没有线索(SC2 适用条件不满足)→SC3 直接说清事由并给默认选项。
    if (persona.visible.some((line) => FUND_CLUE.test(line))) {
      return {
        reply: "好的。想先了解一下,您平时除了炒股之外,在其他银行有没有做过灵活资金的配置?",
        recognizedSignal: "客户持续接话,愿意沟通",
        currentGoal: "摸清客户资金的去向和打理习惯,找到可对比点",
        usedCardId: SEED_CARD_IDS.discovery,
      };
    }

    return {
      reply:
        "那我不绕弯子了。行里最近有个代发客户的活动,资金达标就有微信立减金,月底前报名都来得及。要不要我先帮您预约报名20万那一档?",
      recognizedSignal: "客户持续接话,愿意沟通",
      currentGoal: "把活动事由说清,用默认选项式提问争取预约",
      usedCardId: SEED_CARD_IDS.closing,
    };
  }
}
