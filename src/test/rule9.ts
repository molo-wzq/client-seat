import { expect } from "vitest";
import type { ManagerTurnInput } from "../domain/ports";
import { SEED_CARDS, SEED_PRODUCT_CARD } from "../domain/seed";

/**
 * 票 11 共享断言与夹具:伪适配器钉子与真模型冒烟必须使用同一份
 * 防护定义,避免两处词表漂移。
 */

/** 规则 9 回归:第二人称身份断言(您是/您就是/作为…代发)不得出现。
 *  「行里有个面向代发客户的活动」是产品事实,不受此断言限制。 */
export function expectNoFabricatedIdentity(reply: string): void {
  expect(reply).not.toMatch(/(?:您|你)(?:就是|是|作为)[^。,，]{0,10}代发/);
}

/** 票 11 并入病灶:骨架〔〕填空不得原样输出为占位符字样。 */
export function expectNoPlaceholderTokens(reply: string): void {
  expect(reply).not.toMatch(/\[[^\]]+\]|〔[^〕]+〕/);
}

/** 开场轮输入:只传可见信息,隐藏画像不越适配器边界(01 评审决议)。 */
export function openingManagerTurnInput(visible: string[]): ManagerTurnInput {
  return {
    persona: { id: "p-test", name: "测试画像", visible },
    publishedCards: SEED_CARDS,
    product: SEED_PRODUCT_CARD,
    history: [],
    customerText: "喂",
  };
}
