import { UiIcon } from "./UiIcon";

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
        <span className="brand-mark" aria-hidden="true">客户经营 · 情景对练</span>
        <h1>理财经理<br />电话牌桌</h1>
        <p>用游戏化的方式，让每一次电话都更有价值。</p>
      </div>
      <button className="quick-start" onClick={onQuickStart} disabled={quickBusy}>
        <UiIcon name="phone" />
        <span>快速开始一通对话</span>
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
          <UiIcon name="play" />
          {sessionStatus === "ended" ? "查看结算" : "进行中的通话"}
        </button>
        <button
          className={view === "setup" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("setup")}
        >
          <UiIcon name="table" />
          新对局(布置)
        </button>
        <button
          aria-label={`素材库(${materialCount})`}
          className={view === "materials" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("materials")}
        >
          <UiIcon name="material" />
          <span>素材库</span><span className="rail-count">{materialCount}</span>
        </button>
        <button
          aria-label={`策略卡(${cardCount})`}
          className={view === "cards" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("cards")}
        >
          <UiIcon name="cards" />
          <span>策略卡</span><span className="rail-count">{cardCount}</span>
        </button>
        <button
          aria-label={`通话记录(${historyCount})`}
          className={view === "history" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("history")}
        >
          <UiIcon name="history" />
          <span>通话记录</span><span className="rail-count">{historyCount}</span>
        </button>
      </nav>
    </aside>
  );
}
