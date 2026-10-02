import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { createInProcessProductCore } from "../product/in-process-product-api";
import type { ManagerTurnInput } from "./ports";
import { SEED_PERSONA } from "./seed";

describe("断流后的权威通话恢复", () => {
  it("生成期间请求恢复通话,等待该轮落库后再返回,避免恢复旧记录", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class PausedAdapter extends FakeModelAdapter {
      override async generateManagerTurn(input: ManagerTurnInput) {
        entered();
        await gate;
        return super.generateManagerTurn(input);
      }
    }
    const api = createInProcessProductCore({ adapter: new PausedAdapter() });
    const call = await api.startConversation(SEED_PERSONA.id);
    const generating = api.sendCustomerTurn(call.id, "喂");
    await started;
    const recovering = api.getConversation(call.id);
    release();
    const [saved, restored] = await Promise.all([generating, recovering]);
    expect(restored.turns).toEqual(saved.turns);
    expect(restored.turns).toHaveLength(2);
  });
});
