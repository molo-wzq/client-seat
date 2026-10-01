import { describe, expect, it } from "vitest";
import { createInProcessProductCore } from "../product/in-process-product-api";
import { RecordingAdapter } from "../test/recording-adapter";
import { expectNumbersOnlyFromProductCard } from "../test/dialogue-guards";
import type { ManagerTurnInput, ManagerTurnOutput } from "../domain/ports";
import { MAX_MANAGER_TURNS } from "./product-core";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { SEED_CARD_IDS, SEED_PERSONA, SEED_PERSONAS, SEED_TRANSCRIPT } from "./seed";

/** 慢适配器:制造模型响应延迟,放大并发请求的竞态窗口。 */
class SlowAdapter extends FakeModelAdapter {
  override async generateManagerTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return super.generateManagerTurn(input);
  }
}

/** 产品卡事实签名:未了解需求前不应出现。 */
const PRODUCT_FACTS = /立减金|参考年化|2%|3%/;

/** 产品卡之外的编造事实:经理话术里出现即违规。 */
const OUT_OF_CARD_FACTS = /保本|复利|刚性兑付|年化[约]?[4-9]%|立减金[3-9]\d+元/;

/** 隐藏画像的签名内容(P01):经理输出中出现即泄露。 */
const HIDDEN_SIGNATURES = ["15万", "保险推销", "戒心"];

async function setup() {
  const adapter = new RecordingAdapter();
  const api = createInProcessProductCore({ adapter });
  return { api, adapter };
}

/** 发布种子三张卡并以指定画像开始通话;say 逐轮发送客户发言。 */
async function publishedConversation(
  api: ReturnType<typeof createInProcessProductCore>,
  personaId = SEED_PERSONA.id,
) {
  const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
  await api.publishMaterialCards(material.id);
  const conversation = await api.startConversation(personaId);
  async function say(text: string) {
    return api.sendCustomerTurn(conversation.id, text);
  }
  return { material, conversation, say };
}

describe("策略驱动的自适应对话", () => {
  it("AI 始终以理财经理身份回应,开场引用生客开场卡", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);
    await say("喂");

    const fresh = await api.getConversation(conversation.id);
    expect(fresh.turns).toHaveLength(2);
    expect(fresh.turns[0]?.speaker).toBe("customer");
    expect(fresh.turns[1]?.speaker).toBe("manager");
    expect(fresh.turns[1]?.usedCardId).toBe(SEED_CARD_IDS.opening);
    // 纯对话:无角色前缀、无旁白。
    expect(fresh.turns[1]?.text).not.toMatch(/^(经理|理财经理|AI)[:：]/);
  });

  it("未了解必要需求时不进入产品介绍(不出现产品卡事实)", async () => {
    const { api } = await setup();
    const { say } = await publishedConversation(api);

    const opening = await say("喂");
    const neutral = await say("嗯");

    for (const turn of [opening, neutral]) {
      const reply = turn.turns.at(-1)!.text;
      expect(reply).not.toMatch(PRODUCT_FACTS);
      expect(reply).not.toMatch(OUT_OF_CARD_FACTS);
    }
  });

  it("客户软拒绝时先接住并降低压力,不追加推销", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);

    await say("喂");
    const after = await say("再说吧,暂时不考虑这个");
    const reply = after.turns.at(-1)!.text;
    expect(reply).toMatch(/理解|不着急|没关系|不打扰/);
    expect(reply).not.toMatch(PRODUCT_FACTS);

    const fresh = await api.getConversation(conversation.id);
    expect(fresh.status).toBe("ongoing");
  });

  it("客户拒绝累计三次才挂断:前两次先接住继续,第三次礼貌收口", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);

    await say("喂");
    const first = await say("再说吧,暂时不考虑这个");
    expect(first.status).toBe("ongoing");
    expect(first.turns.at(-1)!.text).toMatch(/理解|不着急|没关系|不打扰/);
    expect(first.turns.at(-1)!.text).not.toMatch(PRODUCT_FACTS);

    const second = await say("再考虑一下吧");
    expect(second.status).toBe("ongoing");

    const third = await say("不用了,别打了");
    const fresh = await api.getConversation(conversation.id);
    expect(fresh.status).toBe("ended");
    expect(fresh.endReason).toContain("三次拒绝");
    expect(third.turns.at(-1)!.text).toMatch(/不打扰|再见/);
  });

  it("明确拒绝同样计入累计:未满三次不结束通话", async () => {
    const { api } = await setup();
    const { say } = await publishedConversation(api);

    await say("喂");
    const first = await say("好了好了,不用了,拜拜");
    expect(first.status).toBe("ongoing");
    expect(first.turns.at(-1)!.text).not.toMatch(/立减金|报名/);

    const second = await say("别打了");
    expect(second.status).toBe("ongoing");

    const third = await say("不用了,挂了");
    expect(third.status).toBe("ended");
    expect(third.endReason).toContain("三次拒绝");
    expect(third.turns.at(-1)!.text).toMatch(/不打扰|再见/);
  });

  it("客户第一句即拒绝时不立即挂断,先争取继续通话", async () => {
    const { api } = await setup();
    const { say } = await publishedConversation(api);

    const after = await say("不用了,别打了");
    expect(after.status).toBe("ongoing");
    const reply = after.turns.at(-1)!.text;
    // 争取继续:一句话说清来意并给退路,不做完整开场推销,不报产品权益。
    expect(reply).toMatch(/一句话|半分钟/);
    expect(reply).toMatch(/好吗|再说/);
    expect(reply).not.toMatch(/立减金|报名|方便简单聊两句/);
  });

  it("同一通话并发发送两条客户发言,轮次不丢失、序号连续", async () => {
    const api = createInProcessProductCore({ adapter: new SlowAdapter() });
    await api.publishMaterialCards((await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT })).id);
    const conversation = await api.startConversation(SEED_PERSONA.id);

    // 双击发送/重试的并发形态:两个请求基于同一旧快照,若不串行化会互相覆盖丢轮次。
    await Promise.all([
      api.sendCustomerTurn(conversation.id, "喂"),
      api.sendCustomerTurn(conversation.id, "我的钱都在股市"),
    ]);

    const fresh = await api.getConversation(conversation.id);
    expect(fresh.turns).toHaveLength(4);
    expect(fresh.turns.map((t) => t.number)).toEqual([1, 2, 3, 4]);
    expect(fresh.turns.map((t) => t.speaker)).toEqual(["customer", "manager", "customer", "manager"]);
  });

  it("了解需求后进入产品介绍,事实全部来自虚拟产品卡", async () => {
    const { api } = await setup();
    const { say } = await publishedConversation(api);

    await say("喂");
    await say("嗯");
    // 票 30 之后:先给线索(去向)→ 经理先接住、只追问一层(金额);金额补齐才算摸清资金现状。
    const followUp = await say("我的钱都在股市,平时做国债逆回购,T+1的");
    const followUpReply = followUp.turns.at(-1)!.text;
    expect(followUpReply).not.toMatch(PRODUCT_FACTS);
    expect((followUpReply.match(/[？?]/g) ?? []).length).toBeLessThanOrEqual(1);

    const after = await say("大概二十来万吧,平时要用的");
    const reply = after.turns.at(-1)!.text;

    expect(reply).toMatch(/2%/);
    expect(reply).toMatch(/T\+1/);
    // p3 语体:权益锚着客户自己的钱报(客户二十来万→锚定20万档),数字仍全部出自产品卡
    expect(reply).toContain("20万");
    expect(reply).toContain("150");
    expectNumbersOnlyFromProductCard(reply);
    expect(reply).not.toMatch(OUT_OF_CARD_FACTS);
  });

  it("达成合理下一步后确认并结束通话", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);

    await say("喂");
    await say("嗯");
    await say("我的钱都在股市,平时做国债逆回购");
    await say("行,那你帮我报上吧,顺便加个微信");

    const fresh = await api.getConversation(conversation.id);
    expect(fresh.status).toBe("ended");
    expect(fresh.endReason).toContain("下一步");
    expect(fresh.outcomeSummary).toBeTruthy();
    const lastManager = fresh.turns.filter((t) => t.speaker === "manager").at(-1);
    expect(lastManager?.usedCardId).toBe(SEED_CARD_IDS.closing);
  });

  it("达到经理轮数上限时通话自动结束", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);

    await say("喂");
    for (let i = 1; i < MAX_MANAGER_TURNS; i++) {
      await say("嗯");
    }

    const fresh = await api.getConversation(conversation.id);
    expect(fresh.status).toBe("ended");
    expect(fresh.endReason).toContain("轮数上限");
    const managerTurns = fresh.turns.filter((t) => t.speaker === "manager");
    expect(managerTurns).toHaveLength(MAX_MANAGER_TURNS);
  });

  it("只检索已发布策略;未发布的卡不得被引用", async () => {
    const { api, adapter } = await setup();

    // 发布前:对话输入不含任何策略卡。
    const before = await api.startConversation(SEED_PERSONA.id);
    await api.sendCustomerTurn(before.id, "喂");
    expect(adapter.dialogueInputs.at(-1)?.publishedCards).toHaveLength(0);

    const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    // 只发布 SC2/SC3:开场卡保持草稿,不可被检索与引用。
    await api.publishCards(material.id, [material.cards[1]!.id, material.cards[2]!.id]);

    const conversation = await api.startConversation(SEED_PERSONA.id);
    await api.sendCustomerTurn(conversation.id, "喂");
    await api.sendCustomerTurn(conversation.id, "嗯");

    const inputs = adapter.dialogueInputs.slice(-2);
    expect(inputs[0]?.publishedCards.map((c) => c.id)).toEqual([
      material.cards[1]!.id,
      material.cards[2]!.id,
    ]);
    const fresh = await api.getConversation(conversation.id);
    const cardIds = fresh.turns
      .filter((t) => t.speaker === "manager")
      .map((t) => t.usedCardId);
    expect(cardIds).not.toContain(SEED_CARD_IDS.opening);
  });

  it("经理输出不泄露隐藏画像信息(输出层回归防线)", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);

    await say("喂");
    await say("嗯");
    await say("我的钱都在股市,平时做国债逆回购");

    const fresh = await api.getConversation(conversation.id);
    for (const turn of fresh.turns.filter((t) => t.speaker === "manager")) {
      for (const signature of HIDDEN_SIGNATURES) {
        expect(turn.text).not.toContain(signature);
      }
    }
  });

  it("内置画像差异引起不同策略路径(可见资金线索走 SC2,无线索走 SC3)", async () => {
    const { api } = await setup();
    await api.publishMaterialCards((await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT })).id);

    // P02(可见含到账/定期线索)→ 走 SC2 现状了解
    const p02 = await api.startConversation(SEED_PERSONAS[1]!.id);
    await api.sendCustomerTurn(p02.id, "喂");
    await api.sendCustomerTurn(p02.id, "嗯");
    const p02Turns = (await api.getConversation(p02.id)).turns
      .filter((t) => t.speaker === "manager")
      .map((t) => t.usedCardId);
    expect(p02Turns[1]).toBe(SEED_CARD_IDS.discovery);

    // P03(可见含定期到期线索,同样走 SC2;定期到期也是资金线索,不再视作无线索)
    const p03 = await api.startConversation(SEED_PERSONAS[2]!.id);
    await api.sendCustomerTurn(p03.id, "喂");
    await api.sendCustomerTurn(p03.id, "嗯");
    const p03Turns = (await api.getConversation(p03.id)).turns
      .filter((t) => t.speaker === "manager")
      .map((t) => t.usedCardId);
    expect(p03Turns[1]).toBe(SEED_CARD_IDS.discovery);

    // 自定义画像可见信息无任何资金线索(SC2 适用条件不满足)→ 直接以 SC3 事由争取预约
    const noClue = await api.savePersona({
      name: "新搬来的老师",
      visible: ["客户刚搬来附近,行内业务很少"],
      hidden: [],
    });
    const noClueConversation = await api.startConversation(noClue.id);
    await api.sendCustomerTurn(noClueConversation.id, "喂");
    await api.sendCustomerTurn(noClueConversation.id, "嗯");
    const noClueTurns = (await api.getConversation(noClueConversation.id)).turns
      .filter((t) => t.speaker === "manager")
      .map((t) => t.usedCardId);
    expect(noClueTurns[1]).toBe(SEED_CARD_IDS.closing);

    expect(p02Turns).not.toEqual(noClueTurns);
  });

  it("话术已告别而元数据未结束时,通话按告别收口兜底结束", async () => {
    // 元数据缺失/判 false、话术最后一句已是明确告别:不能停在"进行中"等用户再发言。
    class FarewellAdapter extends FakeModelAdapter {
      constructor(private readonly farewell: boolean) {
        super();
      }
      override async generateManagerTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput> {
        if (input.history.length === 0) return super.generateManagerTurn(input);
        return {
          reply: this.farewell
            ? "好的,那就不占用您时间了。我是咱们行的客户经理,有需要您随时找我,再见。"
            : "好的,那我就先说到这儿。您还有什么想了解的,随时问我。",
          // 模拟元数据降级:无 shouldEnd、无用卡,不伪造任何结构化结论。
          recognizedSignal: "客户持续接话",
        };
      }
    }
    async function drive(farewell: boolean) {
      const api = createInProcessProductCore({ adapter: new FarewellAdapter(farewell) });
      await api.publishMaterialCards(
        (await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT })).id,
      );
      const conversation = await api.startConversation(SEED_PERSONA.id);
      await api.sendCustomerTurn(conversation.id, "喂");
      const after = await api.sendCustomerTurn(conversation.id, "嗯");
      return after;
    }

    const ended = await drive(true);
    expect(ended.status).toBe("ended");
    expect(ended.endReason).toContain("告别");
    expect(ended.outcomeSummary).toBe("未知");
    // 兜底只结束通话状态,不伪造用卡。
    expect(ended.turns.at(-1)?.usedCardId).toBeUndefined();

    const ongoing = await drive(false);
    expect(ongoing.status).toBe("ongoing");
  });
});

describe("重新生成经理回复(票 31)", () => {
  it("重摇替换最后一轮经理话术,不追加客户轮、轮次号保持连续", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);
    await say("喂");
    const before = await api.getConversation(conversation.id);
    const customerCount = before.turns.filter((t) => t.speaker === "customer").length;

    const after = await api.regenerateManagerTurn(conversation.id);

    expect(after.turns.length).toBe(before.turns.length);
    expect(after.turns.filter((t) => t.speaker === "customer").length).toBe(customerCount);
    expect(after.turns.at(-1)?.speaker).toBe("manager");
    expect(after.turns.at(-1)?.number).toBe(before.turns.at(-1)?.number);
    expect(after.turns.at(-2)?.speaker).toBe("customer");
  });

  it("最后一轮不是经理话术时报错,不动数据", async () => {
    const { api } = await setup();
    const { conversation } = await publishedConversation(api);
    await expect(api.regenerateManagerTurn(conversation.id)).rejects.toThrow(/不是经理回复/);
  });

  it("通话已结束后不可重摇", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);
    // 累计三次拒绝才结束通话。
    await say("不用了,谢谢");
    await say("别打了");
    await say("不用了,挂了");
    await expect(api.regenerateManagerTurn(conversation.id)).rejects.toThrow(/已结束/);
  });
});

describe("通话逻辑归因与卡外数字守卫(p4)", () => {
  /** 编造型适配器:客户给出金额后,经理报卡外收益与利息,并带一句 logicHint。 */
  class FabricatingAdapter extends FakeModelAdapter {
    override async generateManagerTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput> {
      if (input.customerText.includes("十五万")) {
        return {
          reply: "您这15万放咱这,年化3.5%,一个月就有400来块利息。",
          logicHint: "地图未画完就报了数字",
        };
      }
      return super.generateManagerTurn(input);
    }
  }

  it("卡外数字如实标记、logicHint 透传落库,话术本身不改不拦", async () => {
    const api = createInProcessProductCore({ adapter: new FabricatingAdapter() });
    const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    await api.publishMaterialCards(material.id);
    const conversation = await api.startConversation(SEED_PERSONA.id);
    await api.sendCustomerTurn(conversation.id, "喂");
    const after = await api.sendCustomerTurn(conversation.id, "我有十五万闲钱");

    const turn = after.turns.at(-1);
    expect(turn?.speaker).toBe("manager");
    expect(turn?.text).toContain("年化3.5%"); // 只标不拦:话术原样落库
    expect(turn?.outOfCardFact).toBe(true); // 3.5% 与 400块 都不在白名单
    expect(turn?.logicHint).toBe("地图未画完就报了数字");
  });

  it("数字全部有出处时不标记", async () => {
    const { api } = await setup();
    const { say } = await publishedConversation(api);
    await say("喂");
    const after = await say("大概二十来万吧,平时做国债逆回购");
    // 追问金额的轮次不带数字,后续锚定轮的数字出自产品卡或客户口述。
    const turn = after.turns.at(-1);
    expect(turn?.speaker).toBe("manager");
    expect(turn?.outOfCardFact).toBeUndefined();
  });
});
