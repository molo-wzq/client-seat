import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CurrentResearchReport } from "../domain/research-report";
import type { ProductCore } from "../domain/product-core";
import { UiIcon } from "./UiIcon";

type DrawerSectionKey = "macro" | "sector" | "product" | "risk";

export function ResearchDrawer({
  api,
  onOpenFullReport,
}: {
  api: ProductCore;
  onOpenFullReport?: () => void;
}) {
  const [report, setReport] = useState<CurrentResearchReport | null>(null);
  const [activeSection, setActiveSection] = useState<DrawerSectionKey | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  function closeDrawer() {
    setClosing(true);
  }

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setActiveSection(null);
      setClosing(false);
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    if (!activeSection) return;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setClosing(true);
      }
      if (event.key !== "Tab") return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0']");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      trigger?.focus({ preventScroll: true });
    };
  }, [activeSection]);

  useEffect(() => {
    let unmounted = false;
    async function load() {
      if (typeof api.getCurrentResearchReport === "function") {
        try {
          const data = await api.getCurrentResearchReport();
          if (!unmounted && data) setReport(data);
        } catch {
          // 降级兜底
        }
      }
    }
    void load();
    return () => {
      unmounted = true;
    };
  }, [api]);

  function copyText(text: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopyHint("已复制话术到剪贴板");
        setTimeout(() => setCopyHint(null), 2000);
      }).catch(() => undefined);
    }
  }

  function downloadFullReport() {
    window.open("/api/research/download", "_blank");
  }

  const sections = report?.sections;

  return (
    <div className="research-desk-panel" aria-label="周度投研弹药库">
      <header className="research-desk-header">
        <div className="research-title-group">
          <span className="research-eyebrow">本周投研要点</span>
          <h3>投研弹药库</h3>
          <small className="research-period">{report?.period ?? "2026-10-19 ~ 10-23"}</small>
        </div>
        <button
          type="button"
          className="research-download-btn"
          title="下载本周完整14章投研分析报告(HTML/PDF)"
          onClick={downloadFullReport}
        >
          <UiIcon name="play" /> 下载完整周报
        </button>
      </header>

      <p className="research-desk-caption">
        按实战通话场景拆分，点击即查即用，支持一键复制实操话术。
      </p>

      {/* 4 个分段抽屉卡片入口 */}
      <div className="research-card-rack">
        {/* 1. 宏观与开场 */}
        <button
          type="button"
          className={`research-rack-card ${activeSection === "macro" ? "active" : ""}`}
          onClick={() => { setClosing(false); setActiveSection("macro"); }}
          aria-haspopup="dialog"
          aria-expanded={activeSection === "macro"}
        >
          <span className="rack-card-top">
            <span className="rack-icon">🌡️</span>
            <strong>宏观开场</strong>
            <span className="rack-badge">破冰话术</span>
          </span>
          <span className="rack-desc">
            {sections?.macro.headline ?? "A股进入底部区间，仓位从纯防守转向防守反击"}
          </span>
        </button>

        {/* 2. 行业轮动 */}
        <button
          type="button"
          className={`research-rack-card ${activeSection === "sector" ? "active" : ""}`}
          onClick={() => { setClosing(false); setActiveSection("sector"); }}
          aria-haspopup="dialog"
          aria-expanded={activeSection === "sector"}
        >
          <span className="rack-card-top">
            <span className="rack-icon">🧭</span>
            <strong>行业轮动</strong>
            <span className="rack-badge">主线资金</span>
          </span>
          <span className="rack-desc">
            {sections?.sector.summary ?? "高低切换明显：自主可控半导体与低波红利双向配置"}
          </span>
        </button>

        {/* 3. 资产配置与产品推荐 */}
        <button
          type="button"
          className={`research-rack-card ${activeSection === "product" ? "active" : ""}`}
          onClick={() => { setClosing(false); setActiveSection("product"); }}
          aria-haspopup="dialog"
          aria-expanded={activeSection === "product"}
        >
          <span className="rack-card-top">
            <span className="rack-icon">💼</span>
            <strong>资产产品</strong>
            <span className="rack-badge">重点池</span>
          </span>
          <span className="rack-desc">
            防御层45%（低波固收+）+ 均衡层35%（红利低波）+ 进攻层20%
          </span>
        </button>

        {/* 4. 异议答疑与风险 */}
        <button
          type="button"
          className={`research-rack-card ${activeSection === "risk" ? "active" : ""}`}
          onClick={() => { setClosing(false); setActiveSection("risk"); }}
          aria-haspopup="dialog"
          aria-expanded={activeSection === "risk"}
        >
          <span className="rack-card-top">
            <span className="rack-icon">🛡️</span>
            <strong>异议答疑</strong>
            <span className="rack-badge">客户抗拒</span>
          </span>
          <span className="rack-desc">
            {sections?.risk.summary ?? "“行情差不敢买/利率低”等高频异议应对弹药"}
          </span>
        </button>
      </div>

      {copyHint && createPortal(<div className="copy-toast" role="status">{copyHint}</div>, document.body)}

      {/* 侧拉滑出抽屉浮层 */}
      {activeSection && createPortal(
        <div className={`drawer-backdrop${closing ? " closing" : ""}`} onClick={closeDrawer}>
          <aside
            className="drawer-panel open"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            aria-labelledby="drawer-section-heading"
          >
            <header className="drawer-header">
              <h4 id="drawer-section-heading">
                {activeSection === "macro" && "🌡️ 宏观温度计与开场破冰话术"}
                {activeSection === "sector" && "🧭 行业轮动主线与资金流向"}
                {activeSection === "product" && "💼 资产配置比例与重点产品推荐"}
                {activeSection === "risk" && "🛡️ 客户高频异议答疑与风险提醒"}
              </h4>
              <button
                type="button"
                className="close-drawer-btn"
                onClick={closeDrawer}
                aria-label="关闭抽屉"
              >
                ✕
              </button>
            </header>

            <div className="drawer-body">
              {activeSection === "macro" && sections && (
                <>
                  <div className="drawer-callout">
                    <strong>大盘温度计：</strong>{sections.macro.temperature}
                  </div>
                  <div className="drawer-cards-list">
                    {sections.macro.cards.map((card, idx) => (
                      <article key={idx} className="drawer-script-card">
                        <header>
                          <strong>{card.title}</strong>
                          {card.tag && <span className="drawer-card-tag">{card.tag}</span>}
                          {card.copyableText && (
                            <button
                              type="button"
                              className="copy-btn"
                              onClick={() => copyText(card.copyableText!)}
                            >
                              复制话术
                            </button>
                          )}
                        </header>
                        <p>{card.content}</p>
                      </article>
                    ))}
                  </div>
                </>
              )}

              {activeSection === "sector" && sections && (
                <>
                  <div className="drawer-callout">
                    <strong>轮动总览：</strong>{sections.sector.summary}
                  </div>
                  <h5>🔥 主力净流入赛道</h5>
                  <ul className="sector-list">
                    {sections.sector.leadingSectors.map((s, idx) => (
                      <li key={idx}>
                        <span className="sector-name">{s.name}</span>
                        <span className="sector-change positive">{s.change}</span>
                        <span className="sector-reason">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                  <h5>🛡️ 避险防御方向</h5>
                  <ul className="sector-list">
                    {sections.sector.defensiveSectors.map((s, idx) => (
                      <li key={idx}>
                        <span className="sector-name">{s.name}</span>
                        <span className="sector-change">{s.change}</span>
                        <span className="sector-reason">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                  {sections.sector.cards.map((card, idx) => (
                    <article key={idx} className="drawer-script-card">
                      <header>
                        <strong>{card.title}</strong>
                        {card.copyableText && (
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() => copyText(card.copyableText!)}
                          >
                            复制话术
                          </button>
                        )}
                      </header>
                      <p>{card.content}</p>
                    </article>
                  ))}
                </>
              )}

              {activeSection === "product" && sections && (
                <>
                  <div className="drawer-callout">
                    <strong>三层配置建议：</strong>
                    <br />• {sections.product.allocationAdvice.conservative}
                    <br />• {sections.product.allocationAdvice.balanced}
                    <br />• {sections.product.allocationAdvice.aggressive}
                  </div>

                  <h5>⭐ 重点推荐产品池</h5>
                  <div className="pool-list">
                    {sections.product.featuredPool.map((p, idx) => (
                      <div key={idx} className="pool-item">
                        <strong>{p.name}</strong>
                        <span className="pool-type">{p.type}</span>
                        <p className="pool-highlight">{p.highlight}</p>
                      </div>
                    ))}
                  </div>

                  {sections.product.cards.map((card, idx) => (
                    <article key={idx} className="drawer-script-card">
                      <header>
                        <strong>{card.title}</strong>
                        {card.tag && <span className="drawer-card-tag">{card.tag}</span>}
                        {card.copyableText && (
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() => copyText(card.copyableText!)}
                          >
                            复制话术
                          </button>
                        )}
                      </header>
                      <p>{card.content}</p>
                    </article>
                  ))}
                </>
              )}

              {activeSection === "risk" && sections && (
                <>
                  <div className="drawer-callout">
                    <strong>异议处理原则：</strong>{sections.risk.summary}
                  </div>
                  <div className="objections-list">
                    {sections.risk.objections.map((obj, idx) => (
                      <div key={idx} className="objection-item">
                        <div className="obj-q">❓ {obj.question}</div>
                        <div className="obj-a">
                          <button
                            type="button"
                            className="copy-btn mini"
                            onClick={() => copyText(obj.reply.replace(/^[“”"']|[“”"']$/g, ""))}
                          >
                            复制回复
                          </button>
                          {obj.reply}
                        </div>
                      </div>
                    ))}
                  </div>

                  <h5>📅 下周宏观与市场大事</h5>
                  <ul className="watch-list">
                    {sections.risk.nextWeekWatch.map((item, idx) => (
                      <li key={idx}>• {item}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <footer className="drawer-footer">
              <button
                type="button"
                className="drawer-action-btn ghost"
                onClick={downloadFullReport}
              >
                📥 下载完整14章周报
              </button>
              {onOpenFullReport && (
                <button
                  type="button"
                  className="drawer-action-btn primary"
                  onClick={() => {
                    setActiveSection(null);
                    onOpenFullReport();
                  }}
                >
                  在线查看全文 ↗
                </button>
              )}
            </footer>
          </aside>
        </div>,
        document.body,
      )}
    </div>
  );
}
