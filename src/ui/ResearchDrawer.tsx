import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CurrentResearchReport, ScriptCard } from "../domain/research-report";
import type { ProductCore } from "../domain/product-core";
import { playSfx } from "./game-feel";
import "./intel-folder.css";
import {
  ARMED_OBJECTION_LIMIT,
  getArmedObjections,
  objectionLine,
  subscribeArmedObjections,
  toggleArmedObjection,
} from "./intel-objections";

/**
 * 投研弹药库 · 情报档案夹(参赛要求功能,布置幕常驻)。
 * 桌边一只牛皮纸档案夹 → 翻开成情报桌,四张情报卡像一手牌摊开:
 * 宏观温度计 / 行业热力 / 产品筹码 / 异议拆弹。数据全部来自当期分段 JSON,
 * 不进经理提示词;异议可「甩给经理」,作为客户快捷回复带进对局。
 */
type SectionKey = "macro" | "sector" | "product" | "risk";

const SECTIONS: Array<{ key: SectionKey; suit: string; name: string; sub: string; no: string }> = [
  { key: "macro", suit: "温", name: "宏观开场", sub: "温度计 · 破冰话术", no: "01" },
  { key: "sector", suit: "热", name: "行业轮动", sub: "热力格 · 主线资金", no: "02" },
  { key: "product", suit: "筹", name: "资产产品", sub: "筹码 · 重点池", no: "03" },
  { key: "risk", suit: "拆", name: "异议答疑", sub: "拆弹 · 甩给经理", no: "04" },
];

const STALE_DAYS = 7;

export function weekNumber(title?: string): string | null {
  return title?.match(/第\s*(\d+)\s*周/)?.[1] ?? null;
}

/** updatedAt 形如「Sat 2026-10-24 4:00 PM CST」,只取日期判断是否超过一周未更新。 */
export function isStale(updatedAt: string | undefined, now: Date = new Date()): boolean {
  const day = updatedAt?.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!day) return false;
  const updated = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return now.getTime() - updated.getTime() > STALE_DAYS * 86_400_000;
}

export function percentile(temperature?: string): number | null {
  const hit = temperature?.match(/(\d+(?:\.\d+)?)\s*%\s*分位/);
  if (!hit) return null;
  return Math.max(0, Math.min(100, Number(hit[1])));
}

function weight(text: string): number {
  return Number(text.match(/(\d+(?:\.\d+)?)\s*%/)?.[1] ?? 0);
}

function changeValue(change: string): number {
  const n = Number(change.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function ResearchDrawer({
  api,
  onOpenFullReport,
}: {
  api: ProductCore;
  onOpenFullReport?: () => void;
}) {
  const [report, setReport] = useState<CurrentResearchReport | null>(null);
  const [active, setActive] = useState<SectionKey | null>(null);
  const [closing, setClosing] = useState(false);
  const [stamped, setStamped] = useState<string | null>(null);
  const [armed, setArmed] = useState<string[]>(() => getArmedObjections());
  const panelRef = useRef<HTMLElement>(null);
  const stampTimer = useRef<number | undefined>(undefined);

  useEffect(() => subscribeArmedObjections(() => setArmed(getArmedObjections())), []);
  useEffect(() => () => window.clearTimeout(stampTimer.current), []);

  useEffect(() => {
    let unmounted = false;
    (async () => {
      if (typeof api.getCurrentResearchReport !== "function") return;
      try {
        const data = await api.getCurrentResearchReport();
        if (!unmounted && data) setReport(data);
      } catch {
        // 降级:档案夹照常显示,内容为空态
      }
    })();
    return () => {
      unmounted = true;
    };
  }, [api]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setActive(null);
      setClosing(false);
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [closing]);

  const isOpen = active !== null;
  useEffect(() => {
    if (!isOpen) return;
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
      const controls = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']");
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
  }, [isOpen]);

  function open(key: SectionKey) {
    setClosing(false);
    if (!active) playSfx("card");
    setActive(key);
  }

  function copy(id: string, text: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      playSfx("stamp");
      setStamped(id);
      window.clearTimeout(stampTimer.current);
      stampTimer.current = window.setTimeout(() => setStamped(null), 1600);
    }).catch(() => undefined);
  }

  function downloadFullReport() {
    window.open("/api/research/download", "_blank");
  }

  const sections = report?.sections;
  const week = weekNumber(report?.title);
  const stale = isStale(report?.updatedAt);
  const heat = percentile(sections?.macro.temperature);

  function scriptNotes(cards: ScriptCard[], prefix: string) {
    return (
      <div className="intel-notes">
        {cards.map((card, idx) => {
          const id = `${prefix}-${idx}`;
          const text = card.copyableText ?? card.content;
          return (
            <article key={id} className={`intel-note${stamped === id ? " stamped" : ""}`} style={{ "--tilt": `${(idx % 3) - 1}deg` } as CSSProperties}>
              <header>
                <strong>{card.title}</strong>
                {card.tag && <span className="intel-note-tag">{card.tag}</span>}
              </header>
              <p>{card.content}</p>
              <button type="button" className="intel-copy" onClick={() => copy(id, text)} aria-label={`复制话术:${card.title}`}>
                复制话术
              </button>
              {stamped === id && <span className="intel-stamp" aria-hidden="true">已复制</span>}
            </article>
          );
        })}
        {stamped && <span className="visually-hidden" role="status">已复制话术到剪贴板</span>}
      </div>
    );
  }

  return (
    <div className="intel-dock" aria-label="周度投研弹药库">
      <div className={`intel-folder${stale ? " stale" : ""}`}>
        <span className="intel-folder-tab">WEEK / {week ?? "--"}</span>
        <span className={`intel-folder-seal${stale ? " stale" : ""}`} aria-hidden="true">{stale ? "待更新" : "本周情报"}</span>
        <span className="intel-clip" aria-hidden="true" />
        <span className="intel-eyebrow">投研弹药库 · {report?.period ?? "本周"}</span>
        <h3>本周情报档案</h3>
        <p className="intel-temp">{sections?.macro.temperature ?? "周报加载中…"}</p>
        {stale && <p className="intel-stale-hint">这份周报已超过 {STALE_DAYS} 天未更新，话术里的行情判断请先核对。</p>}
        <ul className="intel-index">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className="intel-index-tab"
                onClick={() => open(s.key)}
                aria-haspopup="dialog"
                aria-expanded={active === s.key}
              >
                <i aria-hidden="true">{s.suit}</i>
                <span>{s.name}</span>
                <small>{s.sub}</small>
              </button>
            </li>
          ))}
        </ul>
        <footer className="intel-folder-foot">
          <button type="button" className="intel-open" onClick={() => open("macro")} aria-label="翻开本周情报档案">翻开档案 ↗</button>
          {armed.length > 0 && <span className="intel-armed-count" title="已甩给经理的客户异议，开局后出现在快捷回复里">已甩 {armed.length} 句异议上桌</span>}
        </footer>
      </div>

      {active && createPortal(
        <div className={`intel-backdrop${closing ? " closing" : ""}`} onClick={() => setClosing(true)}>
          <section
            className="intel-desk"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-labelledby="intel-desk-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="intel-desk-head">
              <div>
                <span className="intel-eyebrow">CONFIDENTIAL · WEEK / {week ?? "--"} · {report?.period ?? ""}</span>
                <h4 id="intel-desk-title">本周情报桌</h4>
              </div>
              <div className="intel-desk-actions">
                <button type="button" className="intel-ghost" onClick={downloadFullReport}>下载整本档案</button>
                {onOpenFullReport && (
                  <button type="button" className="intel-ghost" onClick={() => { setActive(null); onOpenFullReport(); }}>在线读全文</button>
                )}
                <button type="button" className="intel-close" onClick={() => setClosing(true)} aria-label="合上档案">✕</button>
              </div>
            </header>

            <nav className="intel-hand" aria-label="四张情报卡">
              {SECTIONS.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  className={`intel-card-face suit-${s.key}${active === s.key ? " picked" : ""}`}
                  style={{ "--fan": `${(i - 1.5) * 4}deg`, "--deal": `${i * 70}ms` } as CSSProperties}
                  aria-pressed={active === s.key}
                  onClick={() => setActive(s.key)}
                >
                  <span className="intel-card-no">CASE / {s.no}</span>
                  <i aria-hidden="true">{s.suit}</i>
                  <strong>{s.name}</strong>
                  <small>{s.sub}</small>
                </button>
              ))}
            </nav>

            <div className="intel-spread" key={active}>
              {!sections && <p className="intel-empty">本周周报还没送到。周报生成后会自动出现在这里。</p>}

              {active === "macro" && sections && (
                <>
                  <div className="intel-gauge-row">
                    <figure className="intel-gauge" aria-label={`估值分位 ${heat ?? "未知"}%`}>
                      <svg viewBox="0 0 200 120" aria-hidden="true">
                        <path d="M20 105 A80 80 0 0 1 180 105" className="gauge-track" />
                        <path d="M20 105 A80 80 0 0 1 180 105" className="gauge-fill" pathLength={100} style={{ strokeDasharray: `${heat ?? 0} 100` }} />
                        <g className="gauge-needle" style={{ "--needle": `${((heat ?? 50) / 100) * 180 - 90}deg` } as CSSProperties}>
                          <line x1="100" y1="105" x2="100" y2="38" />
                          <circle cx="100" cy="105" r="7" />
                        </g>
                      </svg>
                      <figcaption><b>{heat !== null ? `${heat}%` : "--"}</b><span>历史估值分位</span></figcaption>
                    </figure>
                    <div className="intel-brief">
                      <span className="intel-label">核心研判</span>
                      <p className="intel-headline">{sections.macro.headline}</p>
                      <p className="intel-muted">{sections.macro.temperature}</p>
                    </div>
                  </div>
                  {scriptNotes(sections.macro.cards, "macro")}
                </>
              )}

              {active === "sector" && sections && (
                <>
                  <p className="intel-headline">{sections.sector.summary}</p>
                  <div className="intel-heat">
                    {[
                      ...sections.sector.leadingSectors.map((s) => ({ ...s, kind: "lead" as const })),
                      ...sections.sector.defensiveSectors.map((s) => ({ ...s, kind: "guard" as const })),
                    ].map((s) => (
                      <HeatTile key={`${s.kind}-${s.name}`} name={s.name} change={s.change} reason={s.reason} kind={s.kind} />
                    ))}
                  </div>
                  <p className="intel-legend"><span className="lead">红 = 主力净流入</span><span className="guard">绿 = 避险防御</span><span>格子越大，涨幅越大 · 点格子翻面看理由</span></p>
                  {scriptNotes(sections.sector.cards, "sector")}
                </>
              )}

              {active === "product" && sections && (
                <>
                  <div className="intel-chips">
                    {([
                      ["防御", sections.product.allocationAdvice.conservative, "guard"],
                      ["均衡", sections.product.allocationAdvice.balanced, "even"],
                      ["进攻", sections.product.allocationAdvice.aggressive, "attack"],
                    ] as const).map(([label, text, tone]) => {
                      const pct = weight(text);
                      const chips = Math.max(1, Math.round(pct / 5));
                      return (
                        <figure key={label} className={`chip-stack tone-${tone}`}>
                          <div className="chip-pile" aria-hidden="true">
                            {Array.from({ length: chips }, (_, i) => <span key={i} style={{ "--i": i } as CSSProperties} />)}
                          </div>
                          <figcaption><b>{pct ? `${pct}%` : "--"}</b><span>{label}层</span><small>{text.replace(/^[^（(]*[（(]|[）)]$/g, "")}</small></figcaption>
                        </figure>
                      );
                    })}
                  </div>
                  <div className="intel-tickets">
                    {sections.product.featuredPool.map((p) => (
                      <article key={p.name} className="intel-ticket">
                        <span className="intel-ticket-type">{p.type}</span>
                        <strong>{p.name}</strong>
                        {p.code && <code>{p.code}</code>}
                        <p>{p.highlight}</p>
                      </article>
                    ))}
                  </div>
                  {scriptNotes(sections.product.cards, "product")}
                </>
              )}

              {active === "risk" && sections && (
                <>
                  <p className="intel-headline">{sections.risk.summary}</p>
                  <p className="intel-muted">点卡片翻面看应答；「甩给经理」后，开局时这句话会出现在你的客户快捷回复里（最多 {ARMED_OBJECTION_LIMIT} 句），只给你用，不喂给经理。</p>
                  <div className="intel-bombs">
                    {sections.risk.objections.map((obj, idx) => {
                      const line = objectionLine(obj.question);
                      const id = `risk-${idx}`;
                      return (
                        <DefuseCard
                          key={id}
                          question={line}
                          reply={obj.reply}
                          armed={armed.includes(line)}
                          stamped={stamped === id}
                          onCopy={() => copy(id, obj.reply.replace(/^[“”"']|[“”"']$/g, ""))}
                          onArm={() => { playSfx("card"); setArmed(toggleArmedObjection(line)); }}
                        />
                      );
                    })}
                  </div>
                  {sections.risk.nextWeekWatch.length > 0 && (
                    <aside className="intel-watch">
                      <span className="intel-label">下周盯盘</span>
                      <ul>{sections.risk.nextWeekWatch.map((item) => <li key={item}>{item}</li>)}</ul>
                    </aside>
                  )}
                </>
              )}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}

function HeatTile({ name, change, reason, kind }: { name: string; change: string; reason: string; kind: "lead" | "guard" }) {
  const [flipped, setFlipped] = useState(false);
  const size = Math.min(4, 1 + Math.abs(changeValue(change)));
  return (
    <button
      type="button"
      className={`heat-tile ${kind}${flipped ? " flipped" : ""}`}
      style={{ "--grow": size.toFixed(2), "--heat": Math.min(1, 0.45 + Math.abs(changeValue(change)) / 6).toFixed(2) } as CSSProperties}
      aria-pressed={flipped}
      onClick={() => setFlipped((v) => !v)}
    >
      <span className="heat-front"><strong>{name}</strong><b>{change}</b></span>
      <span className="heat-back">{reason}</span>
    </button>
  );
}

function DefuseCard({ question, reply, armed, stamped, onCopy, onArm }: {
  question: string;
  reply: string;
  armed: boolean;
  stamped: boolean;
  onCopy: () => void;
  onArm: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <article className={`defuse-card${flipped ? " flipped" : ""}${armed ? " armed" : ""}`}>
      <button type="button" className="defuse-flip" aria-pressed={flipped} onClick={() => setFlipped((v) => !v)}>
        <span className="defuse-front"><span className="intel-label">客户说</span>「{question}」<small>点击翻面看应答</small></span>
        <span className="defuse-back"><span className="intel-label">这样接</span>{reply}</span>
      </button>
      <div className="defuse-actions">
        <button type="button" className="intel-copy" onClick={onCopy}>复制回复</button>
        <button type="button" className={`intel-arm${armed ? " on" : ""}`} aria-pressed={armed} onClick={onArm}>
          {armed ? "已甩上桌 · 收回" : "甩给经理"}
        </button>
      </div>
      {stamped && <span className="intel-stamp" aria-hidden="true">已复制</span>}
    </article>
  );
}
