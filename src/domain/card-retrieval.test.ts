import { describe, expect, it } from "vitest";
import { selectCardsForTurn } from "./card-retrieval";
import type { ConversationTurn, StrategyCard } from "./types";

function card(id: string, triggerKeywords?: string[]): StrategyCard {
  return {
    id,
    name: `卡${id}`,
    status: "published",
    sourceExcerpt: { materialTitle: "素材", turnRange: "T01–T02" },
    triggerSignals: ["语义信号"],
    ...(triggerKeywords ? { triggerKeywords } : {}),
    applicableScenario: "",
    currentPurpose: "",
    actionChain: [],
    expressionPrinciples: [],
    referenceScripts: [],
    applicableConditions: [],
    stopConditions: [],
  };
}

function customerTurn(text: string, number: number): ConversationTurn {
  return { number, speaker: "customer", text };
}

describe("世界书式检索注入", () => {
  const keywordCard = card("k1", ["到期", "定期"]);
  const otherCard = card("k2", ["报名"]);
  const constantCard = card("c1");

  it("关键词命中即上桌:本轮与窗口内历史客户发言都算", () => {
    const history = [customerTurn("喂", 1)];
    expect(selectCardsForTurn([keywordCard], history, "我有一笔钱快到期了").map((c) => c.id)).toEqual(["k1"]);
    expect(selectCardsForTurn([keywordCard], [customerTurn("那笔定存到期了", 1)], "嗯").map((c) => c.id)).toEqual(["k1"]);
  });

  it("无关键词的卡常驻上桌(蓝灯语义),旧数据零迁移", () => {
    expect(selectCardsForTurn([constantCard, otherCard], [], "喂").map((c) => c.id)).toEqual(["c1"]);
  });

  it("窗口之外的历史发言不参与匹配", () => {
    // 窗口=最近 2 条客户发言:前两条的「到期」已出窗,本轮无命中则关键词卡不上桌。
    const history = [
      customerTurn("到期", 1),
      customerTurn("好的", 3),
      customerTurn("嗯嗯", 5),
    ];
    expect(selectCardsForTurn([keywordCard], history, "再说吧").map((c) => c.id)).toEqual([]);
  });

  it("经理话术不参与匹配:只扫客户发言", () => {
    const history: ConversationTurn[] = [
      customerTurn("喂", 1),
      { number: 2, speaker: "manager", text: "您那笔钱是不是快到期了?" },
      customerTurn("你谁啊", 3),
    ];
    expect(selectCardsForTurn([keywordCard], history, "你说吧").map((c) => c.id)).toEqual([]);
  });

  it("拉丁关键词不区分大小写,多卡命中顺序保持原序", () => {
    const a = card("a", ["app"]);
    const b = card("b", ["App Store"]);
    expect(selectCardsForTurn([a, b], [], "我刚看了APP STORE").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("零命中返回空数组:策略段落到空库口径,由提示词兜底", () => {
    expect(selectCardsForTurn([keywordCard, otherCard], [], "喂,哪位?")).toEqual([]);
  });
});
