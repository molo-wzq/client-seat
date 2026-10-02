import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Conversation, StrategyCard } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { TableAct } from "./TableAct";

function card(id: string, name: string): StrategyCard {
  return {
    id,
    name,
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
  };
}

const CARDS = [card("c1", "开场破冰"), card("c2", "异议接住")];

function conversation(usedCardId?: string): Conversation {
  return {
    id: "conv-1",
    personaId: "p01",
    status: "ongoing",
    turns: usedCardId
      ? [
          { number: 1, speaker: "customer", text: "喂" },
          { number: 2, speaker: "manager", text: "您好", usedCardId, currentGoal: "建立可信度" },
        ]
      : [{ number: 1, speaker: "customer", text: "喂" }],
    createdAt: new Date().toISOString(),
  };
}

function stubApi(conv: Conversation): ProductCore {
  return { getConversation: async () => conv } as unknown as ProductCore;
}

function renderTable(conv: Conversation) {
  return render(
    <TableAct
      api={stubApi(conv)}
      conversationId={conv.id}
      conversation={conv}
      persona={null}
      publishedCards={CARDS}
      onFinished={() => {}}
      onConversationChange={() => {}}
    />,
  );
}

describe("桌面明牌的出牌演出", () => {
  it("进行中对局的初始亮牌只高亮,不触发出牌砸落", () => {
    renderTable(conversation("c1"));
    const active = screen.getByText("开场破冰").closest("li");
    expect(active).toHaveClass("active");
    expect(active).not.toHaveClass("slam");
    expect(screen.getByText("异议接住").closest("li")).not.toHaveClass("active");
  });

  it("经理匹配新卡只显示候选，不播放成功砸落演出", async () => {
    const view = renderTable(conversation("c1"));

    view.rerender(
      <TableAct
        api={stubApi(conversation("c2"))}
        conversationId="conv-1"
        conversation={conversation("c2")}
        persona={null}
        publishedCards={CARDS}
        onFinished={() => {}}
        onConversationChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("异议接住").closest("li")).toHaveClass("active");
      expect(screen.getByText("异议接住").closest("li")).not.toHaveClass("slam");
    });
    expect(screen.getByText("开场破冰").closest("li")).not.toHaveClass("active");
  });

  it("当前目的随最新经理轮展示", () => {
    renderTable(conversation("c1"));
    expect(screen.getByText("建立可信度")).toBeInTheDocument();
  });
});
