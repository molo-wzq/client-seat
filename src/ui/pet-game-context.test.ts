import { describe, expect, it } from "vitest";
import { buildPetChatContext, lastGameOf, managerTurnCount, newlyPlayedCard } from "./pet-game-context";
import { CHAT_CONTEXT_LIMITS } from "../shared/agent-contract";
import type { Conversation, Persona, StrategyCard } from "../domain/types";

/**
 * 牌局快照组装(工单 16)测试缝:纯函数,输入 App 手头的牌局状态,
 * 输出随 chat 触发送出的 ChatContext(契约见 agent-contract)。
 * 只钉字段取舍与上限,不钉渲染措辞(渲染在服务端 workers.renderChatContext)。
 */

const persona: Persona = {
  id: "p-1",
  name: "陈建国",
  visible: ["存款 80 万", "反感推销"],
  hidden: ["儿子留学要用 40 万", "老伴做主"],
};

const card: StrategyCard = {
  id: "sc-1",
  name: "存款搬家",
  status: "published",
  sourceExcerpt: { materialTitle: "外呼录音A", turnRange: "T01–T02", materialId: "m-1" },
  triggerSignals: ["提到存款到期"],
  applicableScenario: "存量生客首次触达",
  currentPurpose: "探明闲置资金",
  actionChain: ["问起近期资金安排"],
  expressionPrinciples: ["短句"],
  referenceScripts: ["您那笔到期的钱打算怎么安排？"],
  applicableConditions: ["客户提到存款"],
  stopConditions: ["客户明确拒绝"],
};

function turn(number: number, speaker: "customer" | "manager", text: string, usedCardId?: string): Conversation["turns"][number] {
  return { number, speaker, text, ...(usedCardId ? { usedCardId } : {}) };
}

function ongoingConversation(turns: Conversation["turns"]): Conversation {
  return {
    id: "c-1",
    personaId: persona.id,
    status: "ongoing",
    turns,
    createdAt: "2026-11-05T10:00:00.000Z",
    resources: { persona, cards: [card], evidence: [] },
  };
}

describe("牌局快照组装(工单 16)", () => {
  it("牌局进行中:公开面、隐藏牌、最近轮次、经理用卡与进度都进快照", () => {
    const context = buildPetChatContext({
      view: "table",
      conversation: ongoingConversation([
        turn(1, "customer", "喂，哪位？"),
        turn(2, "manager", "最近行里有个新活动，您感兴趣吗？", "sc-1"),
        turn(3, "customer", "先说说是什么。"),
      ]),
      lastGame: null,
    });

    expect(context).toEqual({
      phase: "game",
      customer: { name: "陈建国", visible: ["存款 80 万", "反感推销"] },
      hiddenCards: ["儿子留学要用 40 万", "老伴做主"],
      turns: [
        { speaker: "player", text: "喂，哪位？" },
        { speaker: "manager", text: "最近行里有个新活动，您感兴趣吗？" },
        { speaker: "player", text: "先说说是什么。" },
      ],
      cardsPlayed: [{ cardId: "sc-1", cardName: "存款搬家", source: "外呼录音A T01–T02" }],
      turnNumber: 1,
      maxTurns: 12,
      revealedHidden: 0,
      focusTurn: { turnNumber: 1, text: "最近行里有个新活动，您感兴趣吗？" },
    });
  });

  it("只带最近 6 轮;客户说出口的隐藏信息计入已揭示数;同一张卡重复出只记一次出处", () => {
    const turns = [
      turn(1, "customer", "第1句"),
      turn(2, "manager", "第2句", "sc-1"),
      turn(3, "customer", "第3句"),
      turn(4, "manager", "第4句", "sc-1"),
      turn(5, "customer", "第5句,儿子留学要用钱"),
      turn(6, "manager", "第6句"),
      turn(7, "customer", "第7句"),
      turn(8, "manager", "第8句", "sc-1"),
    ];

    const context = buildPetChatContext({
      view: "table",
      conversation: ongoingConversation(turns),
      lastGame: null,
    });

    expect(context?.phase).toBe("game");
    if (context?.phase !== "game") return;
    // 最近 6 轮 = 第 3–8 句;说话人按经理/玩家区分。
    expect(context.turns).toHaveLength(CHAT_CONTEXT_LIMITS.turns);
    expect(context.turns[0]).toEqual({ speaker: "player", text: "第3句" });
    expect(context.turns.at(-1)).toEqual({ speaker: "manager", text: "第8句" });
    // 经理轮序:4 次经理发言(第 2/4/6/8 句)→ 第 4 轮。
    expect(context.turnNumber).toBe(4);
    // 客户第 5 句说出了 1 条 → 已揭示 1/2。
    expect(context.revealedHidden).toBe(1);
    // 同一张卡出过 3 次,快照只记一次。
    expect(context.cardsPlayed).toHaveLength(1);
  });

  it("单轮原文超过上限按契约截断;未知用卡出处写「未知」", () => {
    const longText = "长".repeat(CHAT_CONTEXT_LIMITS.textChars + 10);
    const context = buildPetChatContext({
      view: "table",
      conversation: ongoingConversation([turn(1, "customer", longText), turn(2, "manager", "短句", "sc-unknown")]),
      lastGame: null,
    });

    expect(context?.phase).toBe("game");
    if (context?.phase !== "game") return;
    expect([...context.turns[0]!.text].length).toBe(CHAT_CONTEXT_LIMITS.textChars);
    expect(context.cardsPlayed[0]).toMatchObject({ cardId: "sc-unknown", source: "未知" });
  });

  it("不在牌局:换成所处幕与最近一局摘要;没有历史时只有幕", () => {
    const withHistory = buildPetChatContext({
      view: "postgame",
      conversation: null,
      lastGame: { outcome: "客户答应下周再来", endReason: "经理主动收口" },
    });
    expect(withHistory).toMatchObject({
      phase: "idle",
      act: "复盘",
      lastGame: { summary: expect.stringContaining("客户答应下周再来") },
    });

    const noHistory = buildPetChatContext({ view: "setup", conversation: null, lastGame: null });
    expect(noHistory).toEqual({ phase: "idle", act: "布置" });
    expect("lastGame" in (noHistory ?? {})).toBe(false);
  });

  it("对局已结束(即使还在桌面视图):按不在牌局处理", () => {
    const ended: Conversation = { ...ongoingConversation([]), status: "ended" };
    const context = buildPetChatContext({ view: "table", conversation: ended, lastGame: null });
    expect(context?.phase).toBe("idle");
  });

  it("最近一局结局:结算页在手优先;否则找历史里最近一通有摘要的;都没有为 null", () => {
    const ended: Conversation = {
      ...ongoingConversation([]),
      status: "ended",
      outcomeSummary: "客户答应下周再来",
      endReason: "经理主动收口",
    };
    expect(lastGameOf({ outcome: "当面聊成", endReason: "客户挂断" }, [ended])).toEqual({
      outcome: "当面聊成",
      endReason: "客户挂断",
    });
    expect(lastGameOf(null, [ongoingConversation([]), ended])).toEqual({
      outcome: "客户答应下周再来",
      endReason: "经理主动收口",
    });
    expect(lastGameOf(null, [])).toBeNull();
  });

  it("牌局事件探测(工单 16):经理轮数基线;最新经理轮用了卡才算出卡", () => {
    const turns = [
      turn(1, "customer", "喂"),
      turn(2, "manager", "您那笔钱到期怎么安排?", "sc-1"),
    ];
    expect(managerTurnCount(turns)).toBe(1);
    expect(managerTurnCount([])).toBe(0);
    // 最新经理轮用了卡:解析出卡名;没用卡(如最新轮是客户)→ null。
    expect(newlyPlayedCard(turns, [card])).toEqual({ cardId: "sc-1", cardName: "存款搬家" });
    expect(newlyPlayedCard([turn(1, "customer", "喂")], [card])).toBeNull();
    expect(newlyPlayedCard([turn(2, "manager", "没用药方")], [card])).toBeNull();
    // 查不到的卡:卡名写「未知」口径(用 id 兜底)。
    expect(newlyPlayedCard([turn(2, "manager", "用了新招", "sc-x")], [card])).toEqual({
      cardId: "sc-x",
      cardName: "sc-x",
    });
  });
});
