/**
 * 「/」命令补全(工单 15,纯函数):/投研、/复盘、/换客户、/再来一局,
 * 各自映射到快捷动作(QUICK_RING 同名)。候选过滤与解析在这里,面板只管按键与渲染。
 */
import type { QuickRingAction } from "./pet-reactions";

/** 命令表:前缀「/」+ 对应快捷动作。 */
export const SLASH_COMMANDS: ReadonlyArray<{ command: string; action: QuickRingAction }> = [
  { command: "/投研", action: "本周投研" },
  { command: "/复盘", action: "上局复盘" },
  { command: "/换客户", action: "换个客户" },
  { command: "/再来一局", action: "再来一局" },
];

/** 是否处于命令态:以「/」开头且后面没跟空格(补全完成继续写正文就退出)。 */
export function isSlashActive(draft: string): boolean {
  return draft.startsWith("/") && !draft.includes(" ");
}

/** 命令态下的候选:按前缀过滤,只打「/」给全部。 */
export function slashCandidates(draft: string): ReadonlyArray<{ command: string; action: QuickRingAction }> {
  if (!isSlashActive(draft)) return [];
  return SLASH_COMMANDS.filter((item) => item.command.startsWith(draft));
}

/** 整句解析:恰是某个命令时给对应动作,其余给 null。 */
export function resolveSlashCommand(text: string): QuickRingAction | null {
  return SLASH_COMMANDS.find((item) => item.command === text)?.action ?? null;
}
