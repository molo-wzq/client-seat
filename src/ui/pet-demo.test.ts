import { describe, expect, it } from "vitest";
import {
  DEMO_STEPS,
  currentDemoStep,
  initialDemoState,
  pauseDemo,
  playDemo,
  resetDemo,
  stepDemo,
} from "./pet-demo";

/** 工单 10 的演示共 7 幕(spec 故事 15:①–⑦)。 */
describe("演示脚本数据(工单 10)", () => {
  it("覆盖 ①–⑦ 全部 7 幕,每步带幕号、非空说明与动作数组", () => {
    expect(DEMO_STEPS.length).toBeGreaterThan(0);
    const acts = [...new Set(DEMO_STEPS.map((step) => step.act))];
    expect(acts).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const step of DEMO_STEPS) {
      expect([...step.note].length).toBeGreaterThan(0);
      expect(Array.isArray(step.actions)).toBe(true);
      if (step.holdMs !== undefined) expect(step.holdMs).toBeGreaterThan(0);
    }
  });

  it("脚本全程不依赖真实模型:驱动动作只有命令/触发/放权/表情/舞台", () => {
    const allowed = new Set(["pet", "manager-move", "command", "trigger", "annotate-last-drop", "policy", "focus", "scene"]);
    for (const action of DEMO_STEPS.flatMap((step) => step.actions)) {
      expect(allowed.has(action.kind)).toBe(true);
    }
  });

  it("开场(第①幕第一步)即把放权切到 auto,第⑦幕先观察再切回自动(保留对比)", () => {
    expect(DEMO_STEPS[0].actions).toContainEqual({ kind: "policy", mode: "auto" });

    const act7Modes = DEMO_STEPS.filter((step) => step.act === 7)
      .flatMap((step) => step.actions)
      .filter((action): action is { kind: "policy"; mode: "auto" | "observe" | "off" } => action.kind === "policy")
      .map((action) => action.mode);
    expect(act7Modes).toEqual(["observe", "auto"]);
  });

  it("开场说明用「你来当客户」,全文不出现「客户席」", () => {
    expect(DEMO_STEPS[0].note).toContain("你来当客户");
    for (const step of DEMO_STEPS) {
      expect(step.note).not.toContain("客户席");
    }
  });
});

/** 约定测试缝:演示状态机纯函数(下一步/暂停/重置/越界)。 */
describe("演示状态机纯函数(工单 10)", () => {
  it("初始状态停在第 1 步且未播放", () => {
    const state = initialDemoState();
    expect(state).toEqual({ index: 0, playing: false });
    expect(currentDemoStep(state)).toBe(DEMO_STEPS[0]);
  });

  it("下一步逐格推进", () => {
    const twice = stepDemo(stepDemo(initialDemoState()));
    expect(twice.index).toBe(2);
    expect(currentDemoStep(twice)?.note).toBe(DEMO_STEPS[2]?.note);
  });

  it("越界:连点下一步到头后钳制在总步数,不再前进且自动停播", () => {
    let state = playDemo(initialDemoState());
    for (let i = 0; i < DEMO_STEPS.length + 3; i += 1) state = stepDemo(state);
    expect(state).toEqual({ index: DEMO_STEPS.length, playing: false });
    expect(currentDemoStep(state)).toBeNull();
  });

  it("播放/暂停只切 playing,不动步数", () => {
    const playing = playDemo(initialDemoState());
    expect(playing).toEqual({ index: 0, playing: true });
    const paused = pauseDemo(stepDemo(playing));
    expect(paused).toEqual({ index: 1, playing: false });
  });

  it("演完后再按播放不复活(要重置再来)", () => {
    let finished = initialDemoState();
    for (let i = 0; i < DEMO_STEPS.length; i += 1) finished = stepDemo(finished);
    expect(playDemo(finished).playing).toBe(false);
  });

  it("重置回到第 1 步且停播", () => {
    const anywhere = playDemo(stepDemo(initialDemoState()));
    expect(resetDemo(anywhere)).toEqual(initialDemoState());
  });
});
