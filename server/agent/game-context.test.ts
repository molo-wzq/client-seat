// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ChatContext } from "../../src/shared/agent-contract";
import { assemblePetSystemPrompt, DEFAULT_PET_PERSONA } from "./pet-persona";
import { createPetBot } from "./pet-bot";
import { renderChatContext } from "./workers";
import type { AgentModelMessage, AgentModelPort } from "./workers";

/**
 * 牌局快照只进小贝这一侧的提示词,不进触发账本。
 * 玩家的话不再走 emitTrigger,所以隐藏牌不会随着对话触发落账。
 */

class CapturingModelPort implements AgentModelPort {
  readonly prompts: string[] = [];

  async completeStream(messages: AgentModelMessage[]): Promise<string> {
    this.prompts.push(messages.map((message) => message.content).join("\n"));
    return "[wave]我看了一圈牌桌，这招是想探你的底。";
  }
}

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
  focusTurn: { turnNumber: 3, text: "最近行里有个新活动，您感兴趣吗？" },
};

describe("牌局快照只进小贝提示词", () => {
  it("context 进入小贝提示词,含隐藏牌与当前经理原话,且人格卡里没有建议清单", async () => {
    const model = new CapturingModelPort();
    const opened: unknown[] = [];
    const bot = createPetBot({
      archive: () => ({
        search: () => [],
        periods: [],
      }) as unknown as ReturnType<Parameters<typeof createPetBot>[0]["archive"]>,
      model,
      openWork: async (input) => {
        opened.push(input);
        return { triggerId: "no", admitted: false, ticket: null, report: null };
      },
    });
    const events: unknown[] = [];
    await bot({
      sessionId: "s-1",
      text: "经理这句什么意思",
      history: [],
      notes: [],
      context: gameContext,
    }, (event) => events.push(event));

    const prompt = model.prompts.join("\n");
    expect(prompt).toContain("陈建国");
    expect(prompt).toContain("存款 80 万");
    expect(prompt).toContain("儿子留学要用 40 万");
    expect(prompt).toContain("最近行里有个新活动");
    expect(prompt).toContain("3/12");
    expect(prompt).toContain("存款搬家");
    expect(prompt).toContain(assemblePetSystemPrompt(DEFAULT_PET_PERSONA).slice(0, 12));
    expect(prompt).not.toContain("【建议】");
    expect(prompt).not.toContain("不加表情协议标签");
    expect(opened).toEqual([]);
    const done = events.at(-1) as { type: string; message: { emotion?: string; ticketId?: string } };
    expect(done).toMatchObject({ type: "done", message: { emotion: "wave" } });
    expect(done.message.ticketId).toBeUndefined();
  });

  it("renderChatContext 把当前经理原话写进客户侧快照", () => {
    const text = renderChatContext(gameContext);
    expect(text).toContain("当前经理原话");
    expect(text).toContain("儿子留学要用 40 万");
  });

  it("不在牌局时快照换成所处幕与最近一局摘要", async () => {
    const model = new CapturingModelPort();
    const bot = createPetBot({
      archive: () => ({ search: () => [], periods: [] }) as unknown as ReturnType<Parameters<typeof createPetBot>[0]["archive"]>,
      model,
    });
    const context: ChatContext = {
      phase: "idle",
      act: "复盘",
      lastGame: { summary: "上一局第 2 轮用「存款搬家」收口成功" },
    };
    await bot({ sessionId: "s-1", text: "上局哪里值得学", history: [], notes: [], context }, () => undefined);
    const prompt = model.prompts.join("\n");
    expect(prompt).toContain("复盘");
    expect(prompt).toContain("上一局第 2 轮用「存款搬家」收口成功");
  });
});
