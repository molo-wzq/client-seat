import { useEffect, useState } from "react";
import logoMark from "../assets/brand/logo-mark.png";
import { UiIcon } from "./UiIcon";
import { setSfxEnabled, sfxEnabled } from "./game-feel";

export type AppView = "setup" | "table" | "postgame" | "materials" | "cards" | "roles" | "research" | "history";

export function LeftRail({
  view,
  materialCount,
  cardCount,
  roleCount,
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
  roleCount: number;
  historyCount: number;
  sessionStatus: "ongoing" | "ended" | null;
  /** 目录里存在进行中的通话(内存 session 已不在时,用于找回)。 */
  hasOngoing?: boolean;
  onNavigate: (view: AppView) => void;
  onResumeOngoing: () => void;
  onQuickStart: () => void;
  quickBusy: boolean;
}) {
  // 音效开关:状态由 game-feel 持有(localStorage 记忆),这里只留一份渲染镜像。
  const [sfxOn, setSfxOn] = useState(sfxEnabled());
  // 手机端(≤820px)资料与记录收在抽屉里,抽屉内默认展开;桌面端常开。
  const [toolsOpen, setToolsOpen] = useState(true);
  // 手机抽屉:顶栏「菜单」打开;点导航项、遮罩或 Esc 关闭。桌面端抽屉层 display:contents,不影响布局。
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.dataset.railDrawer = "open";
    return () => {
      document.removeEventListener("keydown", onKey);
      delete document.documentElement.dataset.railDrawer;
    };
  }, [drawerOpen]);

  return (
    <aside className="left-rail" aria-label="对练导航" data-drawer-open={drawerOpen || undefined}>
      <div className="rail-mobile-bar">
        <img className="brand-logo" src={logoMark} alt="" aria-hidden="true" />
        <strong className="rail-mobile-title">理财经理电话牌桌</strong>
        <span className="rail-mobile-view">{VIEW_LABELS[view]}</span>
        <button
          type="button"
          className="rail-menu-btn"
          aria-expanded={drawerOpen}
          aria-controls="rail-drawer"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <span className="rail-menu-icon" aria-hidden="true" />
          {drawerOpen ? "收起" : "菜单"}
        </button>
      </div>
      {drawerOpen && (
        <button type="button" className="rail-backdrop" aria-label="关闭菜单" onClick={() => setDrawerOpen(false)} />
      )}
      <div
        className="rail-drawer"
        id="rail-drawer"
        onClick={(event) => {
          // 点了导航/快速开始就收起抽屉;音效开关和折叠标题不收。
          const target = event.target as HTMLElement;
          if (target.closest("button") && !target.closest(".sfx-toggle")) setDrawerOpen(false);
        }}
      >
      <div className="app-header">
        <span className="brand-mark" aria-hidden="true">
          <img className="brand-logo" src={logoMark} alt="" />
          客户经营 · 情景对练
        </span>
        <h1>理财经理<br />电话牌桌</h1>
        <p>用游戏化的方式，让每一次电话都更有价值。</p>
      </div>
      <button className="quick-start" onClick={onQuickStart} disabled={quickBusy}>
        <UiIcon name="phone" />
        <span>快速开始一通对话</span>
      </button>
      <nav className="rail-nav rail-primary" aria-label="对局">
        <button
          aria-current={view === "table" || view === "postgame" ? "page" : undefined}
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
          aria-current={view === "setup" ? "page" : undefined}
          className={view === "setup" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("setup")}
        >
          <UiIcon name="table" />
          新对局(布置)
        </button>
      </nav>
      <details className="rail-tools" open={toolsOpen} onToggle={(event) => setToolsOpen(event.currentTarget.open)}>
        <summary>资料与记录{["materials", "cards", "roles", "research", "history"].includes(view) ? " · 正在查看" : ""}</summary>
        <nav className="rail-nav" aria-label="资料与记录">
        <button
          aria-current={view === "materials" ? "page" : undefined}
          aria-label={`素材库(${materialCount})`}
          className={view === "materials" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("materials")}
        >
          <UiIcon name="material" />
          <span>素材库</span><span className="rail-count">{materialCount}</span>
        </button>
        <button
          aria-current={view === "cards" ? "page" : undefined}
          aria-label={`策略卡(${cardCount})`}
          className={view === "cards" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("cards")}
        >
          <UiIcon name="cards" />
          <span>策略卡</span><span className="rail-count">{cardCount}</span>
        </button>
        <button
          aria-current={view === "roles" ? "page" : undefined}
          aria-label={`经理角色(${roleCount})`}
          className={view === "roles" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("roles")}
        >
          <UiIcon name="play" />
          <span>经理角色</span><span className="rail-count">{roleCount}</span>
        </button>
        <button
          aria-current={view === "research" ? "page" : undefined}
          aria-label="投研周报"
          className={view === "research" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("research")}
        >
          <UiIcon name="cards" />
          <span>投研周报</span><span className="rail-count">最新</span>
        </button>
        <button
          aria-current={view === "history" ? "page" : undefined}
          aria-label={`通话记录(${historyCount})`}
          className={view === "history" ? "rail-item current" : "rail-item"}
          onClick={() => onNavigate("history")}
        >
          <UiIcon name="history" />
          <span>通话记录</span><span className="rail-count">{historyCount}</span>
        </button>
      </nav>
      <button
        type="button"
        className="rail-item sfx-toggle"
        aria-pressed={sfxOn}
        aria-label="音效开关"
        title={sfxOn ? "关闭音效" : "开启音效"}
        onClick={() => {
          const next = !sfxOn;
          setSfxEnabled(next);
          setSfxOn(next);
        }}
      >
        <UiIcon name={sfxOn ? "volume" : "volumeOff"} />
        <span>{sfxOn ? "音效 · 开" : "音效 · 关"}</span>
      </button>
      </details>
      </div>
    </aside>
  );
}

/** 手机顶栏右侧显示当前所在页(与桌面左栏导航同名)。 */
const VIEW_LABELS: Record<AppView, string> = {
  setup: "对局布置",
  table: "对局中",
  postgame: "复盘",
  materials: "素材库",
  cards: "策略卡",
  roles: "经理角色",
  research: "投研周报",
  history: "通话记录",
};
