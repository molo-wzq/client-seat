import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversationResult } from "../domain/types";
import { ResultStep } from "./ResultStep";

/** 三张隐藏牌:对局中翻开的 / 经理问到边上玩家藏住的 / 整局没碰的。 */
const HIDDEN = [
  "可动用闲钱约15万,其余在股市",
  "上月刚接到过一次保险推销电话,对银行外呼略有戒心",
  "家里还有几笔三年定期陆续到期,手头想留些活钱",
];

function result(): ConversationResult {
  return {
    conversationId: "conv-1",
    mainGoal: "建立身份可信度",
    outcome: "客户愿意继续了解",
    endReason: "客户同意下周再聊",
    turns: [
      { number: 1, speaker: "customer", text: "闲钱也就15万左右,其余都压在股市里。" },
      { number: 2, speaker: "manager", text: "了解,活动门槛您是够的。", usedCardId: "c1" },
      { number: 3, speaker: "customer", text: "没有吧,你说。" },
      { number: 4, speaker: "manager", text: "之前要是接到过推销电话,还请您多担待。", usedCardId: "c1" },
      { number: 5, speaker: "customer", text: "行,你说。" },
      { number: 6, speaker: "manager", text: "我先跟您说下活动规则。" },
    ],
    strategyPath: [],
    resources: {
      persona: { id: "p01", name: "代发·资金在证券", visible: [], hidden: HIDDEN },
      cards: [
        {
          id: "c1",
          name: "开场破冰",
          status: "published",
          sourceExcerpt: { materialTitle: "示例素材", turnRange: "T01–T02" },
          triggerSignals: [],
          applicableScenario: "",
          currentPurpose: "",
          actionChain: [],
          expressionPrinciples: [],
          referenceScripts: [],
          applicableConditions: [],
          stopConditions: [],
        },
      ],
      evidence: [],
    },
  };
}

function renderResult(choices?: Record<string, "flip" | "hold">) {
  return render(
    <ResultStep result={result()} onRestart={() => {}} hiddenChoices={choices ?? {}} />,
  );
}

describe("结算揭晓隐藏牌(工单 04)", () => {
  it("扣着的牌全部翻开,并按局内进度计数", () => {
    renderResult({ [HIDDEN[1]]: "hold" });
    expect(screen.getByRole("heading", { name: /隐藏牌揭晓/ })).toBeInTheDocument();
    expect(screen.getByText(`翻开 1/${HIDDEN.length}`)).toBeInTheDocument();
    for (const item of HIDDEN) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it("经理问到边上没翻开的牌,说明经理漏掉了这个信号", () => {
    renderResult({ [HIDDEN[1]]: "hold" });
    expect(screen.getByText("经理问到边上,但没追问下去")).toBeInTheDocument();
  });

  it("整局没碰的牌,说明经理没问到这个信号", () => {
    renderResult({ [HIDDEN[1]]: "hold" });
    expect(screen.getByText("整局都没问到这个信号")).toBeInTheDocument();
  });

  it("对局中翻开的牌只带原归因,不算经理漏掉", () => {
    renderResult({ [HIDDEN[1]]: "hold" });
    const played = screen.getByText(HIDDEN[0]).closest("li");
    expect(played).toHaveAttribute("data-revealed", "true");
    expect(played?.textContent).toContain("第 1 轮");
  });

  it("玩家点过「翻」的举牌按已翻开展示,不计入漏掉", () => {
    renderResult({ [HIDDEN[1]]: "flip" });
    const flipped = screen.getByText(HIDDEN[1]).closest("li");
    expect(flipped).toHaveAttribute("data-revealed", "true");
    expect(screen.getByText(`翻开 2/${HIDDEN.length}`)).toBeInTheDocument();
    expect(screen.queryByText("经理问到边上,但没追问下去")).not.toBeInTheDocument();
  });
});
