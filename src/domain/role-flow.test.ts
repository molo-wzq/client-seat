import { afterEach, describe, expect, it } from "vitest";
import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import { createInProcessProductCore, InMemoryStorage } from "../product/in-process-product-api";
import { DEFAULT_ROLE_CARD, STEADY_ROLE_CARD } from "./role-card";
import { SEED_CARD_IDS } from "./seed";
import { PROMPT_TUNING_ENV } from "./prompt-tuning";

// src 侧无 node 类型:与 prompt-tuning 同法经 globalThis 取 process。
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

function setup() {
  return createInProcessProductCore({ adapter: new FakeModelAdapter(), storage: new InMemoryStorage() });
}

afterEach(() => {
  if (env) delete env[PROMPT_TUNING_ENV.cardRetrieval];
});

describe("经理角色卡:开局选择与快照", () => {
  it("不选角色时快照默认卡(小王);选老陈则整套打法随局冻结", async () => {
    const api = setup();
    await api.quickStart();
    const seeded = await api.startConversation((await api.listPersonas())[0]!.id);
    expect(seeded.resources?.role?.id).toBe(DEFAULT_ROLE_CARD.id);

    const steady = await api.startConversation((await api.listPersonas())[0]!.id, {
      roleId: STEADY_ROLE_CARD.id,
    });
    expect(steady.resources?.role?.id).toBe(STEADY_ROLE_CARD.id);
  });

  it("换角色后开场自称跟着卡走:老陈的名字进入首轮话术", async () => {
    const api = setup();
    await api.quickStart();
    const conversation = await api.startConversation((await api.listPersonas())[0]!.id, {
      roleId: STEADY_ROLE_CARD.id,
    });
    const after = await api.sendCustomerTurn(conversation.id, "喂");
    expect(after.turns[1]?.text).toContain("老陈");
    expect(after.turns[1]?.text).not.toContain("小王");
  });

  it("重试沿用原局角色,不因默认值漂移;未知角色报错", async () => {
    const api = setup();
    await api.quickStart();
    const personaId = (await api.listPersonas())[0]!.id;
    const first = await api.startConversation(personaId, { roleId: STEADY_ROLE_CARD.id });
    await api.finishConversation(first.id);
    const replay = await api.startConversation(personaId, { replayOfId: first.id });
    expect(replay.resources?.role?.id).toBe(STEADY_ROLE_CARD.id);

    await expect(api.startConversation(personaId, { roleId: "role-nobody" })).rejects.toThrow(
      "经理角色不存在",
    );
  });

  it("listRoles 内置在前;导入的角色校验后分配新 id 入库", async () => {
    const api = setup();
    const builtin = await api.listRoles();
    expect(builtin.map((role) => role.id)).toEqual([DEFAULT_ROLE_CARD.id, STEADY_ROLE_CARD.id]);

    const imported = await api.saveRole({
      name: "老周",
      description: "你是理财经理{{char}}。",
      callLogic: [{ key: "a", name: "规律", law: "为何", usage: "怎么用" }],
      rules: ["只说真话"],
      mesExample: [{ role: "user", content: "喂" }, { role: "assistant", content: "您好" }],
      postHistoryInstructions: "慢慢说。",
    });
    expect(imported.id).not.toBe(DEFAULT_ROLE_CARD.id);
    expect((await api.listRoles()).map((role) => role.id)).toEqual([
      DEFAULT_ROLE_CARD.id,
      STEADY_ROLE_CARD.id,
      imported.id,
    ]);

    await expect(api.saveRole({ name: "" })).rejects.toThrow("角色卡不合法");
  });
});

describe("检索注入实验(LLM_CARD_RETRIEVAL)", () => {
  it("默认关:全量注入,不写 injectedCardIds", async () => {
    const api = setup();
    const conversation = await api.quickStart();
    const after = await api.sendCustomerTurn(conversation.id, "喂");
    const managerTurn = after.turns.find((turn) => turn.speaker === "manager");
    expect(managerTurn?.injectedCardIds).toBeUndefined();
  });

  it("开启后:按客户发言命中上桌,本轮注入落库供复盘核对", async () => {
    if (env) env[PROMPT_TUNING_ENV.cardRetrieval] = "1";
    const api = setup();
    const conversation = await api.quickStart();
    // 「喂」只命中常驻的开场卡(SC1 无关键词常驻;SC2/SC3 的关键词都不含「喂」)。
    const after = await api.sendCustomerTurn(conversation.id, "喂");
    const managerTurn = after.turns.find((turn) => turn.speaker === "manager");
    expect(managerTurn?.injectedCardIds).toEqual([SEED_CARD_IDS.opening]);
    expect(managerTurn?.usedCardId).toBe(SEED_CARD_IDS.opening);

    // 客户说到资金词后,探询卡(SC2 的「到期/定期/闲」等)命中上桌。
    const next = await api.sendCustomerTurn(after.id, "我有笔钱快到期了");
    const secondTurn = next.turns.filter((turn) => turn.speaker === "manager")[1];
    expect(secondTurn?.injectedCardIds).toContain(SEED_CARD_IDS.discovery);
  });
});
