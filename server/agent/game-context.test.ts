import { describe, expect, it } from "vitest";
import { createAgentCore } from "./core";
import { createModelWorkers, type AgentModelMessage, type AgentModelPort } from "./workers";
import { InMemoryLedgerStorage } from "./storage";
import type { LedgerEntry } from "./types";
import type { ChatContext } from "../../src/shared/agent-contract";

/**
 * 牌局快照上下文(工单 16)的隔离测试缝:一律用假模型端口,不发网络请求。
 * - context 只进桌宠对话 Worker 的提示词(客户侧,可含隐藏牌,ADR 0007);
 * - 落账前整个剔除(S4 同一机制):账本任何条目都不含 context 与隐藏牌原文;
 * - 不在牌局时快照换成所处幕与最近一局摘要。
 */

/** 假模型端口:捕获进模型的全部提示词,回一句固定回复(不流式分拍,隔离测试不看节奏)。 */
class CapturingModelPort implements AgentModelPort {
  readonly prompts: string[] = [];

  async completeStream(messages: AgentModelMessage[]): Promise<string> {
    this.prompts.push(messages.map((message) => message.content).join("\n"));
    return "[wave]我看了一圈牌桌，这招是想探你的底。";
  }
}

/** 牌局进行中的样例快照:含客户公开面、玩家隐藏牌、最近轮次、经理用卡与进度。 */
const gameContext: ChatContext = {
  phase: "game",
  customer: { name: "陈建国", visible: ["存款 80 万", "反感推销"] },
  hiddenCards: ["儿子留学要用 40 万"],
  turns: [
    { speaker: "manager", text: "最近行里有个新活动，您感兴趣吗？" },
    { speaker: "player", text: "先说说是什么。" },
  ],
  cardsPlayed: [{ cardId: "sc-1", cardName: "存款搬家", source: "外呼录音A T01–T02" }],
  turnNumber: 3,
  maxTurns: 12,
  revealedHidden: 1,
};

/** 经核心跑一通 chat 触发,拿回账本与模型看到的提示词。 */
async function runChat(context: ChatContext) {
  const model = new CapturingModelPort();
  const storage = new InMemoryLedgerStorage();
  const core = createAgentCore({ storage, worker: createModelWorkers({ routerModel: model }) });
  const outcome = await core.emitTrigger({
    source: "pet",
    kind: "chat",
    data: { text: "经理这句什么意思", history: [], context },
  });
  const entries: LedgerEntry[] = await storage.listLedgerEntries();
  return { model, outcome, entries };
}

describe("牌局快照上下文(工单 16)", () => {
  it("context 进入桌宠提示词:公开面、隐藏牌、轮次进度与经理用卡都在系统提示里", async () => {
    const { model, outcome } = await runChat(gameContext);

    const prompt = model.prompts.join("\n");
    // 客户公开面与隐藏牌:桌宠坐客户一侧,帮玩家推演用的牌都在提示词里。
    expect(prompt).toContain("陈建国");
    expect(prompt).toContain("存款 80 万");
    expect(prompt).toContain("儿子留学要用 40 万");
    // 最近轮次按经理/玩家区分,当前回合进度与已揭示数同在。
    expect(prompt).toContain("最近行里有个新活动");
    expect(prompt).toContain("先说说是什么");
    expect(prompt).toContain("3/12");
    expect(prompt).toContain("1");
    // 经理已出的策略卡及其出处。
    expect(prompt).toContain("存款搬家");
    expect(prompt).toContain("外呼录音A T01–T02");
    // 对话照常收口:ready Report 带表情。
    expect(outcome.report).toMatchObject({ status: "ready", emotion: "wave" });
  });

  it("落账前整个剔除:账本任何条目都不含 context 键与隐藏牌原文(S4 同一机制)", async () => {
    const { entries } = await runChat({
      ...gameContext,
      // 顺手塞一条冒名的顶层 hidden:照旧在进链路前丢弃(既有 S4 行为不回退)。
    } as ChatContext);

    const ledgerJson = JSON.stringify(entries);
    expect(ledgerJson).not.toContain("儿子留学要用 40 万");
    expect(ledgerJson).not.toContain("存款搬家");
    expect(ledgerJson).not.toContain("context");
    // 触发条目仍保留对话正文本身(剔的是 context,不是整条 data)。
    const triggerEntry = entries.find((entry) => entry.type === "trigger");
    expect(JSON.stringify(triggerEntry)).toContain("经理这句什么意思");
  });

  it("不在牌局时:快照换成所处幕与最近一局摘要", async () => {
    const model = new CapturingModelPort();
    const core = createAgentCore({
      storage: new InMemoryLedgerStorage(),
      worker: createModelWorkers({ routerModel: model }),
    });
    const context: ChatContext = {
      phase: "idle",
      act: "复盘",
      lastGame: { summary: "上一局第 2 轮用「存款搬家」收口成功" },
    };

    await core.emitTrigger({ source: "pet", kind: "chat", data: { text: "上局哪里值得学", context } });

    const prompt = model.prompts.join("\n");
    expect(prompt).toContain("复盘");
    expect(prompt).toContain("上一局第 2 轮用「存款搬家」收口成功");
  });
});
