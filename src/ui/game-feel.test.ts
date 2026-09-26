import { beforeEach, describe, expect, it } from "vitest";
import { initPointerSfx, playSfx, setSfxEnabled, sfxEnabled, thump } from "./game-feel";

/**
 * jsdom 没有 AudioContext:这里验证的全部是"安全退化"——
 * 引擎在无声环境不抛错、开关状态可持久化,真实发声留给真机验收。
 */
describe("音效引擎", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认开启,选择写入 localStorage 记忆", () => {
    expect(sfxEnabled()).toBe(true);
    setSfxEnabled(false);
    expect(sfxEnabled()).toBe(false);
    expect(window.localStorage.getItem("duilian-sfx")).toBe("0");
    setSfxEnabled(true);
    expect(sfxEnabled()).toBe(true);
  });

  it("无 AudioContext 环境(jsdom)下各音效安全无操作", () => {
    expect(() => playSfx("click")).not.toThrow();
    expect(() => playSfx("send")).not.toThrow();
    expect(() => playSfx("card")).not.toThrow();
    expect(() => playSfx("dial")).not.toThrow();
    expect(() => playSfx("stamp")).not.toThrow();
    expect(() => playSfx("end")).not.toThrow();
  });

  it("静音状态下发声调用同样安全", () => {
    setSfxEnabled(false);
    expect(() => playSfx("card")).not.toThrow();
  });

  it("震屏与全局绑定在无动画 API 环境下安全无操作", () => {
    const div = document.createElement("div");
    expect(() => thump(div)).not.toThrow();
    expect(() => thump(null)).not.toThrow();
    expect(() => initPointerSfx()).not.toThrow();
  });
});
