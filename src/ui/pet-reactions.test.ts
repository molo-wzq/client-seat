import { describe, expect, it } from "vitest";
import {
  IDLE_SLEEP_MS,
  POKE_LINES,
  QUICK_RING,
  pokeLine,
  reactionExpression,
} from "./pet-reactions";

/** 工单 12 测试缝(纯函数):戳台词轮换、事件→表情映射。 */

describe("戳一下台词轮换(工单 12)", () => {
  it("按戳的次数轮换:到头循环回第一句", () => {
    expect(pokeLine(0).text).toBe(POKE_LINES[0].text);
    expect(pokeLine(1).text).toBe(POKE_LINES[1].text);
    expect(pokeLine(POKE_LINES.length).text).toBe(POKE_LINES[0].text);
    // 次数只会递增,不会回退。
    expect(pokeLine(POKE_LINES.length + 2).text).toBe(POKE_LINES[2].text);
  });

  it("每句台词都配一个表情,切表情不调模型", () => {
    const expressions = new Set(POKE_LINES.map((line) => line.expression));
    // 表情标签齐全可轮换(至少 3 种,戳起来有变化)。
    expect(expressions.size).toBeGreaterThanOrEqual(3);
    for (const line of POKE_LINES) {
      expect(["wave", "think", "cheer", "sleepy", "pout"]).toContain(line.expression);
    }
  });

  it("台词不超过 40 字(气泡上限),且不评价玩家", () => {
    for (const line of POKE_LINES) {
      expect([...line.text].length).toBeLessThanOrEqual(40);
      // 桌宠不评价玩家(CONTEXT/ADR 0007):戳它只撒娇,不说「你不对」这类话。
      expect(line.text).not.toMatch(/你(错|输|不行|失败)/);
    }
  });
});

describe("事件→表情映射(工单 12)", () => {
  it("翻开隐藏牌→cheer;举牌→think;挂断→wave", () => {
    expect(reactionExpression({ kind: "hidden-revealed" })).toBe("cheer");
    expect(reactionExpression({ kind: "hidden-raised" })).toBe("think");
    expect(reactionExpression({ kind: "call-ended" })).toBe("wave");
  });

  it("收到待审不换表情(只晃角标),返回 null", () => {
    expect(reactionExpression({ kind: "todo-arrived" })).toBeNull();
  });
});

describe("共享常量(工单 12)", () => {
  it("快捷芯片沿用快捷环 4 项文案,命令文本一一对应", () => {
    expect(QUICK_RING).toEqual(["换个客户", "再来一局", "上局复盘", "本周投研"]);
  });

  it("闲置入睡阈值是 3 分钟", () => {
    expect(IDLE_SLEEP_MS).toBe(3 * 60 * 1000);
  });
});
