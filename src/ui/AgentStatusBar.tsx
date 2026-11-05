import type { AgentPolicy } from "../shared/agent-contract";

/**
 * Agent 状态条(工单 15):面板顶部一行——
 * 左侧 Agent 状态(在听/在想/在跑 N 件事),点击展开「工作日志」;
 * 右侧放权两档开关「只听我的」(off)⇄「主动办」(auto),observe 收进 ⋯ 菜单,这里不出现。
 * 深绿底(卡纸面板上的呢绒条),人审闸门不受影响。
 */
export function AgentStatusBar({
  awaitingReply,
  runningCount,
  policy,
  onSetMode,
  onToggleLog,
  logOpen,
}: {
  /** 有对话在等回复:在想优先于在跑。 */
  awaitingReply: boolean;
  /** 进行中(progress)的工单数。 */
  runningCount: number;
  policy: AgentPolicy | null;
  /** 两档开关出口:目标档位(off/auto)上报,observe 走 ⋯ 菜单。 */
  onSetMode: (mode: "off" | "auto") => void;
  onToggleLog: () => void;
  logOpen: boolean;
}) {
  const statusText = awaitingReply ? "在想" : runningCount > 0 ? `在跑 ${runningCount} 件事` : "在听";
  return (
    <div className="desk-pet-statusbar" role="group" aria-label="Agent 状态条">
      <button
        type="button"
        className="desk-pet-statusbar-state"
        aria-expanded={logOpen || undefined}
        onClick={onToggleLog}
      >
        <span className="desk-pet-statusbar-dot" data-busy={awaitingReply || runningCount > 0 || undefined} />
        <span role="status">{statusText}</span>
        <span className="desk-pet-statusbar-log-label">{logOpen ? "收起日志" : "工作日志"}</span>
      </button>
      <div className="desk-pet-statusbar-modes" role="group" aria-label="放权">
        <button
          type="button"
          aria-pressed={policy?.acceptMode === "off" ? "true" : "false"}
          onClick={() => onSetMode("off")}
        >
          只听我的
        </button>
        <button
          type="button"
          aria-pressed={policy?.acceptMode === "auto" ? "true" : "false"}
          onClick={() => onSetMode("auto")}
        >
          主动办
        </button>
      </div>
    </div>
  );
}
