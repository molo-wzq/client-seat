import { buildSeedMaterial, SEED_CARDS, SEED_CARD_IDS, SEED_TRANSCRIPT } from "../domain/seed";
import { parseTranscriptTurns } from "../domain/transcript";
import { customerIntent } from '../domain/customer-intent';
import type {
  CopywritingPort,
  DialoguePort,
  ManagerTurnInput,
  ManagerTurnOutput,
  TranscriptAnalysis,
} from "../domain/ports";

/** 客户信号关键词:按真实策略的决策顺序依次匹配。 */
// 演示脚本只认直接授权句:引用、否定、提问、假设不因含「帮我报」就变成承诺。
const AGREE_ENROLL = /^(?:(?:好(?:的|啊|吧)?|行|可以|那|就|嗯|你|请|麻烦你)[，,\s]*)*(?:帮我报(?:上|名)?|给我报(?:上|名)?|报上|报吧|预约吧|加(?:个)?微信)(?:吧|啊|呀|谢谢|[，,\s]|顺便|加(?:个)?微信|[。.!！])*$/;
const AGREE_AFTER_ASK = /^(可以|行|好的|嗯|没问题)[呀啊吧呢]*[。.!！\s]*$/;
/** 客户口述的金额线索(二十万/15万/几十万):资金现状三块之一。 */
const AMOUNT_CLUE = /[一二三四五六七八九十百\d]+\s*[来多]?\s*万/;
/** 客户在问活动资格(资格未知口径:条件式说明,不断言)。 */
const ELIGIBILITY_ASK = /(能|可以)[^。,，?？]{0,6}参加|参加[^。,，?？]{0,8}(吗|么|资格)|我(能|可以)(报|领)|什么(资格|条件)/;
/** 客户口述的资金线索词:说到即视为给出线索,先接住再追问一层(规则 11)。 */
const FUND_HABIT = /(逆回购|闲置|放着|买理财|理财|配置|收益|利息|证券|股市|炒股|定期|活期|到期)/;
/** 画像可见信息中的资金线索:SC2 适用条件之一(定期/到期/存款同样是线索)。 */
const FUND_CLUE = /(证券|股|资产|资金|定期|到期|活期|存款)/;

/**
 * 客户口述资金去向时的回显(p3 语体):按客户实际说的词接话,
 * 不再把所有人都安上国债逆回购;来源依次看本轮口述与历史口述。
 */
const FUND_ECHO: Array<[RegExp, string]> = [
  [/国债逆回购|逆回购/, "您说的国债逆回购确实灵活,就是收益一般不算高"],
  [/股市|证券|炒股/, "您在股市里做得挺活跃的,就是行情起起落落的"],
  [/定期|存款/, "您放定期确实稳当,就是利息一般不算高"],
  [/活期|理财|放着|配置/, "这么打理着确实灵活,就是收益一般不算高"],
];

/** 年长画像的称呼:p3 用词规则——年长客户叫大姐/阿姨,说的是养老金不是工资。 */
function elderlyAddress(persona: ManagerTurnInput["persona"]): string {
  return persona.visible.some((line) => /年长|退休|阿姨|大爷/.test(line)) ? "大姐," : "";
}


/**
 * 伪实现(spec.md 测试决策):确定性脚本驱动端到端测试,
 * 也作为未配置真实模型密钥时的演示兜底。
 *
 * 对话脚本按真实策略的决策顺序组织:开场(SC1)→ 尊重明确离场、
 * 犹豫时征询是否继续 → 资格问询走条件式说明
 * → 资金线索先接住再追问一层,金额已知才进产品介绍(规则 4/11)
 * → 默认分支按画像是否有资金线索选择 SC2 现状了解或 SC3 直接给事由。
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

    if (customerIntent(customerText) === 'leave') {
      return {
        reply: '好的，先不打扰您了。有需要可以通过银行官方渠道联系我们，再见。',
        recognizedSignal: '客户明确离场', currentGoal: '体面收口', shouldEnd: true,
        endReason: '客户明确离场，通话结束', outcomeSummary: '客户结束当前通话，未新增报名或联系授权',
      };
    }
    if (customerIntent(customerText) === 'hesitate') return {
      reply: '理解，那不着急。您愿意先了解一个条件，还是今天先到这里？',
      recognizedSignal: '客户表达犹豫', currentGoal: '接住犹豫，征询是否继续',
    };

    // 第一轮:SC1 生客开场——自报身份、征询时机、身份依据,并一句话说清具体来意。
    // 代发关系是系统里查得到的(p3:画像写明的行内信息当功课说,不问客户)。
    if (history.length === 0) {
      const hasPayrollBasis = persona.visible.some((line) => /代发/.test(line));
      const address = elderlyAddress(persona);
      return {
        reply: hasPayrollBasis
          ? `${address}您好,我是咱们行的理财经理小王,看系统里您工资是咱行代发的。这会儿方便说两句吗?行里有个面向代发客户的资金活动,想跟您说一声。`
          : `${address}您好,我是咱们行的理财经理小王。这会儿方便说两句吗?行里有个客户资金活动想跟您说一声,不耽误您太久。`,
        recognizedSignal: "电话刚接通,客户应答",
        currentGoal: "让客户确认这是本行客户经理的正常服务来电,愿意继续听下去",
        usedCardId: SEED_CARD_IDS.opening,
        cardMatchBasis: "执行开场卡动作链:自报身份、征询时机、说清来意",
      };
    }

    // 客户同意报名/加微信(或回应默认选项式预约):确认承诺并收口(SC3)。
    const lastManager = [...history].reverse().find((turn) => turn.speaker === "manager");
    const askedDefaultOption = Boolean(lastManager && /预约报名/.test(lastManager.text));
    const agreed =
      AGREE_ENROLL.test(customerText) ||
      (askedDefaultOption && AGREE_AFTER_ASK.test(customerText.trim()));
    if (agreed) {
      const enroll = /报|预约/.test(customerText) || (askedDefaultOption && AGREE_AFTER_ASK.test(customerText.trim()));
      const wechat = /微信/.test(customerText);
      const commitment = enroll && wechat ? "核对报名条件并保持微信联系" : enroll ? "核对报名条件后确认报名" : "保持微信联系";
      return {
        reply: enroll
          ? `好嘞,那我先核对报名资格和资金档位,没确认的金额不替您填。${wechat ? "微信联系也按您同意的来。" : "只办您同意的这一步。"}那先不打扰您了,再见。`
          : "好嘞,那只按您同意的微信联系来,不替您报名。那先不打扰您了,再见。",
        recognizedSignal: `客户同意${commitment}`,
        currentGoal: "确认已获授权的下一步并收口",
        usedCardId: SEED_CARD_IDS.closing,
        cardMatchBasis: "执行收口卡动作链:确认承诺、预告后续服务并收口",
        shouldEnd: true,
        endReason: `取得合理下一步:客户同意${commitment}`,
        outcomeSummary: `客户同意${commitment};未填写未确认的金额,未把授权当作已办理成功`,
      };
    }

    // 客户问活动资格(资格未知):介绍面向对象并确认条件,作条件式说明,不断言客户符合(规则 6)。
    if (ELIGIBILITY_ASK.test(customerText)) {
      return {
        reply:
          "这个活动是面向代发工资客户的。我不太确定您是不是这类,要不我帮您看下您符合哪一类,再挑合适的跟您说,可以吗?",
        recognizedSignal: "客户询问活动资格(画像未写明是否符合)",
        currentGoal: "确认客户适用哪类活动,再作对应介绍",
        usedCardId: SEED_CARD_IDS.discovery,
        cardMatchBasis: "执行探询卡动作链:贴着客户问题确认条件,不预设结论",
      };
    }

    // 资金现状三块(在哪/多少/期限)已知:需求已摸清,先认可再对比,把活动权益说
    // 具体(SC2 后半;事实全部来自产品卡)。去向来自本轮口述、此前口述或画像
    // 可见线索,金额来自本轮或此前口述;只给线索不给金额时先追问,不急着推产品(规则 4/11)。
    const habitInText = FUND_HABIT.test(customerText);
    const habitGivenEarlier = history.some(
      (turn) => turn.speaker === "customer" && FUND_HABIT.test(turn.text),
    );
    const clueInPersona = persona.visible.some((line) => FUND_CLUE.test(line));
    const amountKnown =
      AMOUNT_CLUE.test(customerText) ||
      history.some((turn) => turn.speaker === "customer" && AMOUNT_CLUE.test(turn.text));
    if (amountKnown && (habitInText || habitGivenEarlier || clueInPersona)) {
      // 回显客户实际说的资金去向(p3 语体):数字只报一个档位,锚着客户自己的钱。
      const echo =
        FUND_ECHO.find(([re]) => re.test(customerText))?.[1] ??
        FUND_ECHO.find(([re]) =>
          history.some((turn) => turn.speaker === "customer" && re.test(turn.text)),
        )?.[1] ?? "您这笔钱这么打理着挺好的";
      return {
        reply: `${echo}。咱行有个灵活理财,T+1到账,近期参考年化大概2%到3%。您这笔要是赶上新资金的活动,像20万档就有150块微信立减金,不用马上转进来也能报名。`,
        recognizedSignal: "客户说出资金去向与大概金额,资金现状已摸清",
        currentGoal: "让客户意识到机会成本,对本行产品和活动产生兴趣",
        usedCardId: SEED_CARD_IDS.discovery,
        cardMatchBasis: "执行探询卡动作链后段:先认可再对比,权益说具体",
      };
    }

    // 客户给出资金线索但金额未知:先接住确认,再顺着追问一层(金额区间),单问。
    if (habitInText) {
      return {
        reply: "嗯,这么打理的确实不少。那这部分钱大概有个多少呀?",
        recognizedSignal: `客户给出资金线索:${customerText.slice(0, 18)}`,
        currentGoal: "摸清客户资金的去向和打理习惯,找到可对比点",
        usedCardId: SEED_CARD_IDS.discovery,
        cardMatchBasis: "执行探询卡动作链:客户给出线索后先确认再追问一层",
      };
    }

    // 默认分支:画像里有资金线索→SC2 现状了解;没有线索(SC2 适用条件不满足)→SC3 直接说清事由并给默认选项。
    // 年长画像的问法跟着人生阶段走(p3:说的是定期存款,不是股市)。
    if (clueInPersona) {
      return {
        reply: elderlyAddress(persona)
          ? "大姐,那我想先问问,您平时那些钱一般是怎么安排的呀?比如存个定期,或者买点理财。"
          : "行,那我想先了解一下,您平时闲着的钱一般是怎么安排的呀?比如定期、理财,或者放证券账户里。",
        recognizedSignal: "客户持续接话,愿意沟通",
        currentGoal: "摸清客户资金的去向和打理习惯,找到可对比点",
        usedCardId: SEED_CARD_IDS.discovery,
        cardMatchBasis: "执行探询卡动作链:开放式现状提问,一次只问一个",
      };
    }

    return {
      reply:
        "那我就不跟您绕弯子了哈。行里最近有个面向代发客户的活动,资金达标能领微信立减金,月底前报名都来得及。要不我先帮您把20万这一档预约报名上?",
      recognizedSignal: "客户持续接话,愿意沟通",
      currentGoal: "把活动事由说清,用默认选项式提问争取预约",
      usedCardId: SEED_CARD_IDS.closing,
      cardMatchBasis: "执行收口卡动作链:默认选项式预约",
    };
  }
}
