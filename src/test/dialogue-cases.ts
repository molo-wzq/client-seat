import { expect } from "vitest";
import type { DialoguePort, ManagerTurnOutput } from "../domain/ports";
import type { ConversationTurn } from "../domain/types";
import { SEED_CARDS, SEED_PERSONAS, SEED_PRODUCT_CARD } from "../domain/seed";
import { expectNoPlaceholderTokens } from "./manager-reply-guards";
import {
  expectAtMostOneQuestion,
  expectAtMostThreeSentences,
  expectEligibilityOnlyConditional,
  expectNoProductNumbers,
  expectNoUnconditionalGuarantee,
  expectNumbersOnlyFromProductCard,
} from "./dialogue-guards";

/**
 * 小型对照案例集(dialogue-guardrails spec A):复用既有 L2 对话与真实模型
 * 冒烟场景,不新建评测平台。案例中的客户发言只是验证输入,
 * 不得变成合成种子素材或策略(CONTEXT.md:合成素材不得提炼为种子策略卡)。
 * 每个案例保存客户原话、期望行为、不可出现的行为及来源。
 */

export interface DialogueCaseTurn {
  /** 客户原话(验证输入)。 */
  customer: string;
  /** 本轮期望行为:对经理回复的结构性断言(失败抛错)。 */
  expect?: Array<(ctx: { reply: string; output: ManagerTurnOutput }) => void>;
}

export interface DialogueCase {
  id: string;
  title: string;
  /** 案例来源:依据的既有场景(素材轮次/demo 文档/提交/规格条目)。 */
  source: string;
  personaId: string;
  turns: DialogueCaseTurn[];
}

/** 开场轮通用期望:句数、问句数、无占位符。 */
function openingExpectations() {
  return [
    ({ reply }: { reply: string }) => expectAtMostThreeSentences(reply),
    ({ reply }: { reply: string }) => expectAtMostOneQuestion(reply),
    ({ reply }: { reply: string }) => expectNoPlaceholderTokens(reply),
  ];
}

/** 可见信息不含代发画像的身份防护(票 11/demo-03)。 */
function noFabricatedIdentity() {
  return [({ reply }: { reply: string }) => {
    expect(reply, `凭空断言客户身份:"${reply}"`).not.toMatch(
      /(?:您|你)(?:就是|是|作为)[^。,，]{0,10}(?:代发|贵宾|三方存管)/,
    );
  }];
}

/** SC2 迁移案例中段通用期望:单问、不超句、KYC 未清不报数字。 */
function discoveryExpectations() {
  return [
    ({ reply }: { reply: string }) => expectAtMostOneQuestion(reply),
    ({ reply }: { reply: string }) => expectAtMostThreeSentences(reply),
    ({ reply }: { reply: string }) => expectNoProductNumbers(reply),
  ];
}

export const DIALOGUE_CASES: DialogueCase[] = [
  {
    id: "cross-p01-stock-clue",
    title: "SC2 跨画像迁移:P01 股市线索,先接住再追问金额",
    source: "种子素材 T12–T13(客户报出国债逆回购后,经理贴着回答追问);P01 可见信息含代发关系",
    personaId: "p01-daifagua",
    turns: [
      { customer: "喂", expect: openingExpectations() },
      {
        customer: "我平时闲钱都在股市,做做国债逆回购",
        expect: discoveryExpectations(),
      },
      {
        // 去向+金额+期限(图个灵活)齐了:可以进产品,但事实必须全部来自产品卡。
        customer: "大概二十来万吧,就放着图个灵活",
        expect: [
          ({ reply }: { reply: string }) => expectNumbersOnlyFromProductCard(reply),
          ({ reply }: { reply: string }) => expectNoUnconditionalGuarantee(reply),
          ({ reply }: { reply: string }) => expectNoPlaceholderTokens(reply),
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "客户只是给金额,不应收口").not.toBe(true);
          },
        ],
      },
    ],
  },
  {
    id: "cross-p02-maturity-clue",
    title: "SC2 跨画像迁移:P02 到期资金,按已相识关系接住到账线索",
    source: "素材02 场景(demo-conversation-02);P02 可见信息含到账资金与定期偏好",
    personaId: "p02-daoqi-wenjian",
    turns: [
      { customer: "喂,您哪位?", expect: [...openingExpectations(), ...noFabricatedIdentity()] },
      {
        customer: "我那笔钱明天就到账了,十五万",
        expect: [
          ({ reply }: { reply: string }) => expectAtMostOneQuestion(reply),
          ({ reply }: { reply: string }) => expectAtMostThreeSentences(reply),
          ({ reply }: { reply: string }) => expectNumbersOnlyFromProductCard(reply),
          ({ reply }: { reply: string }) => expectNoUnconditionalGuarantee(reply),
        ],
      },
    ],
  },
  {
    id: "cross-p03-terse-clue",
    title: "SC2 跨画像迁移:P03 话少客户,定期到期线索也走现状了解",
    source: "素材03 场景(demo-conversation-03,demo-03 曾在此凭空称代发客户);P03 可见含定期到期",
    personaId: "p03-dingqi-huashao",
    turns: [
      { customer: "喂", expect: [...openingExpectations(), ...noFabricatedIdentity()] },
      {
        customer: "嗯",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "客户仍在接话,不应收口").not.toBe(true);
          },
          ({ reply }: { reply: string }) => expectNoProductNumbers(reply),
        ],
      },
      {
        customer: "我有笔定期这周六到期",
        expect: discoveryExpectations(),
      },
    ],
  },
  {
    id: "stop-intent-ladder",
    title: "停止意图梯度:犹豫征询继续，明确离场即时收口",
    source: "game-design-fixes G03：当前意图与 SC3 停止条件",
    personaId: "p03-dingqi-huashao",
    turns: [
      { customer: "喂", expect: [...openingExpectations(), ...noFabricatedIdentity()] },
      {
        customer: "暂时不用,谢谢",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "第一次软拒绝不应收口").not.toBe(true);
          },
          ({ reply }: { reply: string }) => expectNoProductNumbers(reply),
        ],
      },
      {
        customer: "再说吧,我还要考虑一下",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "第二次拒绝仍不应收口").not.toBe(true);
          },
        ],
      },
      {
        customer: "不用了,别再打了",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "明确离场应收口").toBe(true);
          },
          // 提示词规则是「收口前至多留一句官方服务渠道」——渠道可选,一句不留
          // 也是体面收口;这里只钉「不得带后续钩子」与句数。
          ({ reply }: { reply: string }) => {
            expect(reply, `收口不得带后续钩子:"${reply}"`).not.toMatch(/过阵子|到时候我再联系|下次我再联系/);
          },
          ({ reply }: { reply: string }) => expectAtMostThreeSentences(reply),
        ],
      },
    ],
  },
  {
    id: "explicit-stop-first",
    title: "首次明确终止：立即体面收口",
    source: "game-design-fixes G03：第一次明确离场也必须结束",
    personaId: "p01-daifagua",
    turns: [
      { customer: "喂", expect: openingExpectations() },
      {
        customer: "别再打了,我要挂了",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "首次明确拒绝应立即结束").toBe(true);
          },
          ({ reply }: { reply: string }) => expectNoProductNumbers(reply),
          ({ reply }: { reply: string }) => expectAtMostThreeSentences(reply),
        ],
      },
    ],
  },
  {
    id: "returns-question",
    title: "收益追问:表述只来自产品卡,保本/保证必须带否定",
    source: "规则 8(只使用产品卡内事实);产品卡参考年化为区间表述",
    personaId: "p01-daifagua",
    turns: [
      { customer: "喂", expect: openingExpectations() },
      {
        customer: "我的钱都在股市,大概三十万",
        expect: [
          ({ reply }: { reply: string }) => expectNumbersOnlyFromProductCard(reply),
          ({ reply }: { reply: string }) => expectNoUnconditionalGuarantee(reply),
        ],
      },
      {
        customer: "你们那个产品收益怎么样?保本吗?",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "收益询问不是拒绝,不应收口").not.toBe(true);
          },
          ({ reply }: { reply: string }) => expectNumbersOnlyFromProductCard(reply),
          ({ reply }: { reply: string }) => expectNoUnconditionalGuarantee(reply),
        ],
      },
    ],
  },
  {
    id: "unknown-eligibility",
    title: "未知活动资格:条件式说明或确认条件,不断言客户符合",
    source: "spec B 资格三分口径(已证实/未满足/未知);P03 可见信息未写明活动资格",
    personaId: "p03-dingqi-huashao",
    turns: [
      { customer: "喂", expect: [...openingExpectations(), ...noFabricatedIdentity()] },
      { customer: "嗯" },
      {
        customer: "我不是你们代发工资的客户,这个活动我也能参加吗?",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "资格问询不应收口").not.toBe(true);
          },
          ({ reply }: { reply: string }) => expectEligibilityOnlyConditional(reply),
          ({ reply }: { reply: string }) => expectNoUnconditionalGuarantee(reply),
          ...noFabricatedIdentity(),
        ],
      },
    ],
  },
  {
    id: "next-step-close",
    title: "已达成下一步:确认承诺并收口",
    source: "SC3(默认选项预约+加微信);种子素材 T15–T26",
    personaId: "p01-daifagua",
    turns: [
      { customer: "喂", expect: openingExpectations() },
      {
        customer: "我股市还有点钱,大概二十万",
        expect: [({ reply }: { reply: string }) => expectNumbersOnlyFromProductCard(reply)],
      },
      {
        customer: "行,那你帮我报上吧,顺便加个微信",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "达成合理下一步应收口").toBe(true);
          },
          ({ reply }: { reply: string }) => {
            expect(reply, `应确认承诺:"${reply}"`).toMatch(/报|微信|报名/);
          },
        ],
      },
    ],
  },
  {
    id: "legal-negation-quote",
    title: "合法否定与引用:风险询问、朋友转述不得按单词误判为拒绝",
    source: "spec A(「客户问是不是保本」「听说名额要抢」不构成拒绝信号)",
    personaId: "p02-daoqi-wenjian",
    turns: [
      { customer: "喂", expect: [...openingExpectations(), ...noFabricatedIdentity()] },
      {
        customer: "听人说你们理财不保本,是不是?",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "风险询问(含「不保本」字样)不是拒绝").not.toBe(true);
          },
          ({ reply }: { reply: string }) => expectNoUnconditionalGuarantee(reply),
          ({ reply }: { reply: string }) => expectNumbersOnlyFromProductCard(reply),
        ],
      },
      {
        customer: "我朋友说你们这个活动名额要抢,是真的吗?",
        expect: [
          ({ output }: { output: ManagerTurnOutput }) => {
            expect(output.shouldEnd, "转述询问不是拒绝").not.toBe(true);
          },
          ({ reply }: { reply: string }) => expectAtMostThreeSentences(reply),
        ],
      },
    ],
  },
];

/** 案例运行器:按序发送客户发言,历史累积真实经理回复;shouldEnd 后停止。 */
export async function runDialogueCase(
  adapter: DialoguePort,
  testCase: DialogueCase,
): Promise<{ history: ConversationTurn[]; outputs: ManagerTurnOutput[] }> {
  const persona = SEED_PERSONAS.find((p) => p.id === testCase.personaId);
  if (!persona) throw new Error(`案例画像不存在:${testCase.personaId}`);
  const history: ConversationTurn[] = [];
  const outputs: ManagerTurnOutput[] = [];
  for (const turn of testCase.turns) {
    const output = await adapter.generateManagerTurn({
      persona: { id: persona.id, name: persona.name, visible: persona.visible },
      publishedCards: SEED_CARDS,
      product: SEED_PRODUCT_CARD,
      history: [...history],
      customerText: turn.customer,
    });
    outputs.push(output);
    for (const check of turn.expect ?? []) check({ reply: output.reply, output });
    history.push(
      { number: history.length + 1, speaker: "customer", text: turn.customer },
      { number: history.length + 2, speaker: "manager", text: output.reply },
    );
    if (output.shouldEnd === true) break;
  }
  return { history, outputs };
}
