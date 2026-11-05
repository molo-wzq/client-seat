import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConversationTurn, StrategyCard } from "../domain/types";
import { HiddenCards } from "./HiddenCards";

const HIDDEN = ["可动用闲钱约15万,其余在股市", "上月刚接到过一次保险推销电话,对银行外呼略有戒心"];

const CARDS: StrategyCard[] = [
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
];

/** 会话轮次:客户说出 → 经理用卡回应;轮次按经理轮序计。 */
const SAID_TURNS: ConversationTurn[] = [
  { number: 1, speaker: "customer", text: "闲钱也就15万左右,其余都压在股市里。" },
  { number: 2, speaker: "manager", text: "了解,那活动门槛您是够的。", usedCardId: "c1" },
];

const EDGE_TURNS: ConversationTurn[] = [
  { number: 1, speaker: "customer", text: "喂,你说。" },
  { number: 2, speaker: "manager", text: "之前要是接到过推销电话,还请您多担待。", usedCardId: "c1" },
];

function view() {
  return screen.getByRole("list", { name: "隐藏牌" });
}

describe("隐藏牌(工单 04)", () => {
  it("开局全部背面朝下,进度 0/N,牌背不露原文", () => {
    render(
      <HiddenCards
        items={HIDDEN}
        turns={[]}
        cards={CARDS}
        choices={{}}
        onChoice={() => {}}
        onRaisePendingChange={() => {}}
      />,
    );
    expect(view().querySelectorAll(".hidden-card[data-state='down']")).toHaveLength(2);
    expect(screen.getByText("已翻 0/2")).toBeInTheDocument();
    expect(view().textContent).not.toContain("闲钱");
  });

  it("客户说出 → 自动翻开并标注轮次与用卡", () => {
    render(
      <HiddenCards
        items={HIDDEN}
        turns={SAID_TURNS}
        cards={CARDS}
        choices={{}}
        onChoice={() => {}}
        onRaisePendingChange={() => {}}
      />,
    );
    expect(screen.getByText(HIDDEN[0])).toBeInTheDocument();
    expect(screen.getByText("第 1 轮,经理用『开场破冰』问出来的")).toBeInTheDocument();
    expect(screen.getByText("已翻 1/2")).toBeInTheDocument();
    expect(view().querySelectorAll(".hidden-card[data-state='down']")).toHaveLength(1);
  });

  it("经理问到边上 → 举牌,玩家点「先藏着」保持扣着", async () => {
    const onChoice = vi.fn();
    const user = userEvent.setup();
    render(
      <HiddenCards
        items={HIDDEN}
        turns={EDGE_TURNS}
        cards={CARDS}
        choices={{}}
        onChoice={onChoice}
        onRaisePendingChange={() => {}}
      />,
    );
    const raised = view().querySelector(".hidden-card[data-state='raised']");
    expect(raised).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "先藏着" }));
    expect(onChoice).toHaveBeenCalledWith(HIDDEN[1], "hold");
  });

  it("玩家点「翻」→ 翻开并计入进度;举牌期间回调 pending", async () => {
    const onChoice = vi.fn();
    const onRaisePendingChange = vi.fn();
    const user = userEvent.setup();
    const props = {
      items: HIDDEN,
      turns: EDGE_TURNS,
      cards: CARDS,
      onChoice,
      onRaisePendingChange,
    };
    const rendered = render(<HiddenCards {...props} choices={{}} />);
    await waitFor(() => expect(onRaisePendingChange).toHaveBeenCalledWith(true));
    await user.click(screen.getByRole("button", { name: "翻" }));
    expect(onChoice).toHaveBeenCalledWith(HIDDEN[1], "flip");
    // 受控组件:父层记录选择后回灌,牌才翻开、待决解除。
    rendered.rerender(<HiddenCards {...props} choices={{ [HIDDEN[1]]: "flip" }} />);
    expect(screen.getByText(HIDDEN[1])).toBeInTheDocument();
    expect(screen.getByText("已翻 1/2")).toBeInTheDocument();
    await waitFor(() => expect(onRaisePendingChange).toHaveBeenLastCalledWith(false));
  });

  it("玩家选择「先藏着」后不再举牌,进度不增", () => {
    render(
      <HiddenCards
        items={HIDDEN}
        turns={EDGE_TURNS}
        cards={CARDS}
        choices={{ [HIDDEN[1]]: "hold" }}
        onChoice={() => {}}
        onRaisePendingChange={() => {}}
      />,
    );
    expect(view().querySelectorAll(".hidden-card[data-state='down']")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "翻" })).not.toBeInTheDocument();
    expect(screen.getByText("已翻 0/2")).toBeInTheDocument();
  });

  it("减少动效偏好时标注 data-reduced-motion,不播翻牌动画", () => {
    // jsdom 没有 matchMedia,手写一个命中 reduce 偏好的桩,结束后还原。
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      render(
        <HiddenCards
          items={HIDDEN}
          turns={SAID_TURNS}
          cards={CARDS}
          choices={{}}
          onChoice={() => {}}
          onRaisePendingChange={() => {}}
        />,
      );
      expect(view().querySelector(".hidden-card[data-state='revealed']")).toBeInTheDocument();
      expect(view()).toHaveAttribute("data-reduced-motion", "true");
    } finally {
      window.matchMedia = original;
    }
  });
});
