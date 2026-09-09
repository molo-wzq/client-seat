import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "./fake-model-adapter";
import { SEED_PERSONA, SEED_PERSONA_P03 } from "../domain/seed";
import {
  expectNoFabricatedIdentity,
  openingManagerTurnInput,
} from "../test/manager-reply-guards";

/**
 * 开场轮回归钉子(票 11):可见信息缺"代发"时,伪实现开场
 * 不得断言客户为「代发客户」;有代发依据时才使用该身份。
 * 真实模型的对应防护由提示词规则 9 与冒烟测试覆盖,
 * 断言与冒烟共用 src/test/rule9.ts 的同一份防护定义。
 */
describe("伪适配器:开场轮客户属性防护", () => {
  it("P03(可见信息无代发):开场不断言代发客户身份", async () => {
    const adapter = new FakeModelAdapter();
    const output = await adapter.generateManagerTurn(
      openingManagerTurnInput(SEED_PERSONA_P03.visible),
    );
    expectNoFabricatedIdentity(output.reply);
  });

  it("P01(可见信息含代发):开场使用代发身份依据", async () => {
    const adapter = new FakeModelAdapter();
    const output = await adapter.generateManagerTurn(
      openingManagerTurnInput(SEED_PERSONA.visible),
    );
    expect(output.reply).toContain("代发客户");
  });
});
