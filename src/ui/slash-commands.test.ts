import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, isSlashActive, resolveSlashCommand, slashCandidates } from "./slash-commands";

/** 工单 15 测试缝(纯函数):「/」命令补全的候选过滤与解析。 */

describe("slash-commands(工单 15)", () => {
  it("命令表四项,前缀「/」一一对应快捷动作", () => {
    expect(SLASH_COMMANDS).toEqual([
      { command: "/投研", action: "本周投研" },
      { command: "/复盘", action: "上局复盘" },
      { command: "/换客户", action: "换个客户" },
      { command: "/再来一局", action: "再来一局" },
    ]);
  });

  it("输入以「/」开头才算命令态;候选按前缀过滤,只打「/」给全部", () => {
    expect(isSlashActive("")).toBe(false);
    expect(isSlashActive("在吗")).toBe(false);
    expect(isSlashActive("/")).toBe(true);
    expect(isSlashActive("/投")).toBe(true);
    // 命令后带空格视为离开命令态(用户在补全后继续写正文)。
    expect(isSlashActive("/投研 ")).toBe(false);

    expect(slashCandidates("/").map((item) => item.command)).toEqual(["/投研", "/复盘", "/换客户", "/再来一局"]);
    expect(slashCandidates("/再").map((item) => item.command)).toEqual(["/再来一局"]);
    expect(slashCandidates("/不存在")).toEqual([]);
  });

  it("resolveSlashCommand:整句恰是命令时给对应动作,其余(含多字/带尾巴)给 null", () => {
    expect(resolveSlashCommand("/投研")).toBe("本周投研");
    expect(resolveSlashCommand("/再来一局")).toBe("再来一局");
    expect(resolveSlashCommand("/投研 ")).toBeNull();
    expect(resolveSlashCommand("在吗")).toBeNull();
    expect(resolveSlashCommand("/不认识")).toBeNull();
  });
});
