import { describe, expect, it } from "vitest";
import {
  applyRoleMacros,
  DEFAULT_ROLE_CARD,
  parseRoleCard,
  SEED_ROLES,
  STEADY_ROLE_CARD,
} from "./role-card";
import { MAX_MANAGER_TURNS } from "./product-core";

describe("角色卡宏替换", () => {
  it("{{char}} 与 {{maxTurns}} 渲染期替换,宏名大小写不敏感", () => {
    const text = applyRoleMacros("理财经理{{char}},第{{maxTurns}}轮,{{CHAR}}", {
      char: "老陈",
      maxTurns: MAX_MANAGER_TURNS,
    });
    expect(text).toBe(`理财经理老陈,第${MAX_MANAGER_TURNS}轮,老陈`);
  });

  it("默认卡文本以 {{char}} 携带经理名,示范轮与开场白可整体替换", () => {
    expect(DEFAULT_ROLE_CARD.description).toContain("理财经理{{char}}");
    expect(DEFAULT_ROLE_CARD.rules[4]).toContain("第{{maxTurns}}轮");
    expect(applyRoleMacros(DEFAULT_ROLE_CARD.firstMes, { char: "老陈", maxTurns: 12 })).toContain("理财经理老陈");
  });
});

describe("角色卡导入校验", () => {
  const valid = (): Record<string, unknown> => ({
    name: "老周",
    description: "你是理财经理{{char}}。",
    personality: "爽快",
    callLogicIntro: "三句话的规律:",
    callLogic: [{ key: "a", name: "规律一", law: "为何", usage: "怎么用" }],
    rules: ["第一条", "第二条"],
    firstMes: "您好,我是{{char}}。",
    mesExample: [{ role: "user", content: "喂" }, { role: "assistant", content: "您好" }],
    postHistoryInstructions: "本轮提醒:慢慢说。",
    tags: ["测试"],
    characterVersion: "2",
    creatorNotes: "导入说明",
    unknownField: { keep: true },
  });

  it("合法卡逐字段收进,未知字段原样保留在 extensions", () => {
    const parsed = parseRoleCard(valid());
    expect(parsed.name).toBe("老周");
    expect(parsed.callLogic).toHaveLength(1);
    expect(parsed.mesExample).toHaveLength(2);
    expect(parsed.extensions).toMatchObject({ unknownField: { keep: true } });
  });

  it("缺关键字段整体拒绝,不给半张卡上桌", () => {
    for (const missing of ["name", "description", "rules", "callLogic", "mesExample", "postHistoryInstructions"]) {
      const source = valid() as Record<string, unknown>;
      const broken = Object.fromEntries(Object.entries(source).filter(([key]) => key !== missing));
      expect(() => parseRoleCard(broken), `缺 ${missing} 应拒绝`).toThrow();
    }
  });

  it("规律缺 law/usage 拒绝;示例如缺省,callLogicIntro 给兜底引言", () => {
    const noLaw = valid();
    noLaw.callLogic = [{ key: "a", name: "规律一" }];
    expect(() => parseRoleCard(noLaw)).toThrow();
    const noIntro = valid();
    delete noIntro.callLogicIntro;
    expect(parseRoleCard(noIntro).callLogicIntro).toContain("钱规律");
  });
});

describe("内置角色卡", () => {
  it("两张卡齐备:默认小王与稳重型老陈,规律共用行外夺金四条", () => {
    expect(SEED_ROLES.map((role) => role.id)).toEqual([DEFAULT_ROLE_CARD.id, STEADY_ROLE_CARD.id]);
    expect(DEFAULT_ROLE_CARD.callLogic).toHaveLength(4);
    expect(STEADY_ROLE_CARD.callLogic).toEqual(DEFAULT_ROLE_CARD.callLogic);
  });

  it("稳重型差异落在语体:规则一、示范轮、尾部提醒与默认卡不同", () => {
    expect(STEADY_ROLE_CARD.rules[0]).not.toBe(DEFAULT_ROLE_CARD.rules[0]);
    expect(STEADY_ROLE_CARD.mesExample.at(-1)?.content).not.toBe(DEFAULT_ROLE_CARD.mesExample.at(-1)?.content);
    expect(STEADY_ROLE_CARD.postHistoryInstructions).not.toBe(DEFAULT_ROLE_CARD.postHistoryInstructions);
    // 稳重型沿用默认卡的后七条规则(开场、探询、事实边界等打法合规)。
    expect(STEADY_ROLE_CARD.rules.slice(1)).toEqual(DEFAULT_ROLE_CARD.rules.slice(1));
  });
});
