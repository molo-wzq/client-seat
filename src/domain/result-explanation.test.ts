import { describe, expect, it } from "vitest";
import { createInProcessProductCore } from "../product/in-process-product-api";
import { RecordingAdapter } from "../test/recording-adapter";
import { SCORING_PATTERN } from "../test/scoring-pattern";
import { SEED_PERSONA, SEED_TRANSCRIPT } from "./seed";

/** 完成一通完整通话(P01 画像,四轮走到报名承诺)并取回结果。 */
const DEFAULT_SCRIPT = ["喂", "嗯", "我的钱都在股市,平时做国债逆回购", "行,那你帮我报上吧,顺便加个微信"];

async function completedResult(personaId = SEED_PERSONA.id, script: string[] = DEFAULT_SCRIPT) {
  const { api } = await createBareApi();
  const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
  await api.publishMaterialCards(material.id);
  const conversation = await api.startConversation(personaId);
  for (const line of script) {
    await api.sendCustomerTurn(conversation.id, line);
  }
  const result = await api.getResult(conversation.id);
  return { api, material, result };
}

async function createBareApi() {
  const adapter = new RecordingAdapter();
  const api = createInProcessProductCore({ adapter });
  return { api, adapter };
}

describe("结果解释与素材追溯", () => {
  it("结果展示本轮目标、沟通结果和结束原因,不含任何评分元素", async () => {
    const { result } = await completedResult();

    expect(result.mainGoal).not.toBe("未知");
    expect(result.outcome).toBeTruthy();
    expect(result.endReason).toContain("下一步");
    expect(JSON.stringify(result)).not.toMatch(SCORING_PATTERN);
  });

  it("策略路径与实际对话期间记录的动作一致", async () => {
    const { result } = await completedResult();

    const referencedManagerTurns = result.turns.filter(
      (t) => t.speaker === "manager" && t.usedCardId,
    );
    expect(result.strategyPath).toHaveLength(referencedManagerTurns.length);
    for (const entry of result.strategyPath) {
      const turn = result.turns.find((t) => t.number === entry.turnNumber);
      expect(turn?.speaker).toBe("manager");
      expect(turn?.usedCardId).toBe(entry.cardId);
      // 关键表达就是经理本轮实际说出的话
      expect(turn?.text).toBe(entry.keyExpression);
    }
  });

  it("每个关键动作能追溯到已发布策略卡与原始转写片段", async () => {
    const { material, result } = await completedResult();

    expect(result.strategyPath.length).toBeGreaterThan(0);
    const opening = result.strategyPath.find((e) => e.cardId === "sc-c01-1")!;
    expect(opening).toBeDefined();
    expect(opening.cardName).toBeTruthy();
    expect(opening.source?.materialTitle).toBe(material.title);
    expect(opening.source?.turnRange).toBe("T01–T02");

    // 来源片段解析为原始轮次:内容与素材轮次逐一对应
    expect(opening.sourceTurns.map((t) => t.number)).toEqual([1, 2]);
    for (const turn of opening.sourceTurns) {
      const original = material.turns.find((t) => t.number === turn.number);
      expect(original?.text).toBe(turn.text);
      expect(original?.speaker).toBe(turn.speaker);
    }
    expect(opening.sourceTurns[0]?.text).toContain("客户经理");
  });

  it("使用不同生客画像时,结果反映实际采用的不同策略路径", async () => {
    const { api } = await createBareApi();
    const material = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    await api.publishMaterialCards(material.id);

    // P01:画像带资金线索 → 走 SC2 现状了解
    const p01 = await api.startConversation(SEED_PERSONA.id);
    for (const line of DEFAULT_SCRIPT) await api.sendCustomerTurn(p01.id, line);
    const p01Result = await api.getResult(p01.id);

    // P02:画像无资金线索(SC2 适用条件不满足)→ 跳过现状了解,直接给事由争取预约
    const p02 = await api.savePersona({
      name: "退休教师",
      visible: ["客户是退休教师,行内只有活期存款"],
      hidden: [],
    });
    const p02Conversation = await api.startConversation(p02.id);
    await api.sendCustomerTurn(p02Conversation.id, "喂");
    await api.sendCustomerTurn(p02Conversation.id, "嗯");
    await api.sendCustomerTurn(p02Conversation.id, "可以");
    const p02Result = await api.getResult(p02Conversation.id);

    const p01Cards = p01Result.strategyPath.map((e) => e.cardId);
    const p02Cards = p02Result.strategyPath.map((e) => e.cardId);
    expect(p01Cards).toContain("sc-c01-2");
    expect(p02Cards).not.toContain("sc-c01-2");
    expect(p01Cards).not.toEqual(p02Cards);

    // 两份结果都能各自追溯到策略卡与原始片段
    for (const result of [p01Result, p02Result]) {
      for (const entry of result.strategyPath) {
        expect(entry.source?.materialTitle).toBe(material.title);
      }
    }
  });

  it("素材标题重名时,来源片段仍定位到所属素材(id 关联)", async () => {
    const { api } = await createBareApi();
    const first = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    // 两次分析得到同名素材(标题都取种子场景首句);给第一份的 T01 打上标记。
    const second = await api.analyzeTranscript({ transcript: SEED_TRANSCRIPT });
    expect(second.title).toBe(first.title);

    await api.updateMaterialDraft(first.id, {
      turns: first.turns.map((t, i) => (i === 0 ? { ...t, text: "标记:这是第一份素材的开场" } : t)),
    });
    await api.publishMaterialCards(first.id);

    const conversation = await api.startConversation(SEED_PERSONA.id);
    await api.sendCustomerTurn(conversation.id, "喂");
    await api.finishConversation(conversation.id);
    const result = await api.getResult(conversation.id);

    const opening = result.strategyPath.find((e) => e.cardId === "sc-c01-1")!;
    expect(opening.source?.materialId).toBe(first.id);
    expect(opening.sourceTurns[0]?.text).toContain("标记:这是第一份素材的开场");
  });
});
