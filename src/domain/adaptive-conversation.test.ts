import { describe, expect, it } from "vitest";
import { createInProcessProductCore } from "../product/in-process-product-api";
import { RecordingAdapter } from "../test/recording-adapter";
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

  it("同一策略连续两次软拒绝后停止策略,体面收口结束通话", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);

    await say("喂");
    await say("再说吧,暂时不考虑这个");
    const after = await say("再考虑一下吧");

    const fresh = await api.getConversation(conversation.id);
    expect(fresh.status).toBe("ended");
    expect(fresh.endReason).toContain("无法继续");
    expect(after.turns.at(-1)!.text).toMatch(/不打扰|再见/);
  });

  it("客户明确要求结束时礼貌收口并结束通话", async () => {
    const { api } = await setup();
    const { conversation, say } = await publishedConversation(api);

    await say("喂");
    const after = await say("好了好了,不用了,拜拜");

    const fresh = await api.getConversation(conversation.id);
    expect(fresh.status).toBe("ended");
    expect(fresh.endReason).toContain("客户");
    const reply = after.turns.at(-1)!.text;
    expect(reply).toMatch(/不打扰|再见/);
    expect(reply).not.toMatch(/立减金|报名/);
  });

  it("客户第一句即明确拒绝时直接礼貌收口,不做开场推销", async () => {
    const { api } = await setup();
    const { say } = await publishedConversation(api);

    const after = await say("不用了,别打了");
    expect(after.status).toBe("ended");
    expect(after.endReason).toContain("客户");
    expect(after.turns.at(-1)!.text).toMatch(/不打扰|再见/);
    // 不做开场推销:没有自报身份式的开场话术,也没有产品权益。
    expect(after.turns.at(-1)!.text).not.toMatch(/代发客户|方便简单聊两句|立减金/);
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
    const after = await say("我的钱都在股市,平时做国债逆回购,T+1的");
    const reply = after.turns.at(-1)!.text;

    expect(reply).toMatch(/2%/);
    expect(reply).toMatch(/T\+1/);
    // 分档权益与产品卡一致
    expect(reply).toContain("50元");
    expect(reply).toContain("150元");
    expect(reply).toContain("300元");
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

  it("内置画像差异引起不同策略路径(P03 无资金线索,跳过现状了解)", async () => {
    const { api } = await setup();
    await api.publishMaterialCards((await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT })).id);

    // P02(可见含资金线索)→ 走 SC2 现状了解
    const p02 = await api.startConversation(SEED_PERSONAS[1]!.id);
    await api.sendCustomerTurn(p02.id, "喂");
    await api.sendCustomerTurn(p02.id, "嗯");
    const p02Turns = (await api.getConversation(p02.id)).turns
      .filter((t) => t.speaker === "manager")
      .map((t) => t.usedCardId);
    expect(p02Turns[1]).toBe(SEED_CARD_IDS.discovery);

    // P03(可见无资金线索,SC2 适用条件不满足)→ 直接以 SC3 事由争取预约
    const p03 = await api.startConversation(SEED_PERSONAS[2]!.id);
    await api.sendCustomerTurn(p03.id, "喂");
    await api.sendCustomerTurn(p03.id, "嗯");
    const p03Turns = (await api.getConversation(p03.id)).turns
      .filter((t) => t.speaker === "manager")
      .map((t) => t.usedCardId);
    expect(p03Turns[1]).toBe(SEED_CARD_IDS.closing);

    expect(p02Turns).not.toEqual(p03Turns);
  });
});
