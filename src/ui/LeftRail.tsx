export type AppView = "setup" | "table" | "postgame" | "materials" | "cards" | "history";

export function LeftRail({
  view,
  materialCount,
  cardCount,
  historyCount,
  sessionStatus,
  hasOngoing,
  onNavigate,
  onResumeOngoing,
  onQuickStart,
  quickBusy,
}: {
  view: AppView;
  materialCount: number;
  cardCount: number;
  historyCount: number;
  sessionStatus: "ongoing" | "ended" | null;
  /** 目录里存在进行中的通话(内存 session 已不在时,用于找回)。 */
  hasOngoing?: boolean;
  onNavigate: (view: AppView) => void;
  onResumeOngoing: () => void;
  onQuickStart: () => void;
  quickBusy: boolean;
}) {
  return (
    <aside className="left-rail" aria-label="对练导航">
      <div className="app-header">
        <h1>电话对练</h1>
        <p>左栏是你有的东西,主区是正在打的这一局。</p>
      </div>
      <button onClick={onQuickStart} disabled={quickBusy}>
        快速开始一通对话
      </button>
      <nav className="rail-nav">
        <button
          className={view === "table" || view === "postgame" ? "rail-item current" : "rail-item"}
          onClick={() => {
            if (sessionStatus) {
              onNavigate(sessionStatus === "ended" ? "postgame" : "table");
            } else {
              onResumeOngoing();
            }
          }}
          disabled={!sessionStatus && !hasOngoing}
        >
          {sessionStatus === "ended" ? "查看结算" : "进行中的通话"}
        </button>
        <button
          className={view === "setup" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("setup")}
        >
          新对局(布置)
        </button>
        <button
          className={view === "materials" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("materials")}
        >
          素材库({materialCount})
        </button>
        <button
          className={view === "cards" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("cards")}
        >
          策略卡({cardCount})
        </button>
        <button
          className={view === "history" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("history")}
        >
          通话记录({historyCount})
        </button>
      </nav>
    </aside>
  );
}
