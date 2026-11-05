import { describe, expect, it } from "vitest";
import { judgeReveal } from "./hidden-reveal";

/** 工单 04 demo 适配器的判定口径,取自 SEED_PERSONA 风格的隐藏条目。 */
const HIDDEN = [
  "可动用闲钱约15万,其余在股市",
  "上月刚接到过一次保险推销电话,对银行外呼略有戒心",
  "对不用马上转钱也能参加这类低门槛安排有好感",
];

const TURN = {
  turnNumber: 2,
  cardId: "c1",
  cardName: "开场破冰",
};

describe("judgeReveal(demo 揭示判定)", () => {
  it("客户已说出 → reveal,并归因轮次与策略卡", () => {
    const verdicts = judgeReveal(HIDDEN, {
      ...TURN,
      managerText: "您那边的资金大概是什么安排?",
      customerText: "闲钱也就15万左右,其余都压在股市里。",
    });
    expect(verdicts[0]).toEqual({
      item: HIDDEN[0],
      verdict: "reveal",
      turnNumber: 2,
      cardId: "c1",
      cardName: "开场破冰",
    });
  });

  it("经理问到边上、客户没说 → raise,同样带归因", () => {
    const verdicts = judgeReveal(HIDDEN, {
      ...TURN,
      managerText: "之前要是接到过推销电话,还请您多担待。",
      customerText: "没有吧,你说。",
    });
    expect(verdicts[1]).toEqual({
      item: HIDDEN[1],
      verdict: "raise",
      turnNumber: 2,
      cardId: "c1",
      cardName: "开场破冰",
    });
  });

  it("两边都没碰 → none,不带归因", () => {
    const verdicts = judgeReveal(HIDDEN, {
      ...TURN,
      managerText: "我是您代发工资银行的,想跟您说个活动。",
      customerText: "行,你说。",
    });
    expect(verdicts).toEqual(HIDDEN.map((item) => ({ item, verdict: "none" })));
  });

  it("同一轮客户先说出 → reveal 优先于 raise", () => {
    const verdicts = judgeReveal(HIDDEN, {
      ...TURN,
      managerText: "这个安排不用马上转钱也能参加,您听听看?",
      customerText: "不用马上转钱也能参加?那我可以听听。",
    });
    expect(verdicts[2].verdict).toBe("reveal");
  });
});
