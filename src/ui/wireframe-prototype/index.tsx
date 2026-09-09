/**
 * 低保真线框原型(throwaway,不进生产)。
 *
 * 问题:电话对练前端整体信息架构/流程应怎么组织?(用户反馈:整体逻辑存在问题)
 * 形式:3 个结构不同的线框变体,?wireframe 开启、?variant= 切换,
 *       仅 dev 模式可见(App.tsx 门控);只读、假数据、不连真模型。
 *       变体 A 工作台双栏 / B 首页卡片流 / C 单页三区连续。
 */
import { useEffect, useState, type ReactNode } from "react";
import { SEED_CARDS, SEED_PERSONAS } from "../../domain/seed";
import "./wireframe.css";

const VARIANTS = ["A", "B", "C", "D"] as const;
const LABELS: Record<(typeof VARIANTS)[number], string> = {
  A: "工作台双栏",
  B: "首页卡片流",
  C: "单页三区连续",
  D: "棋盘对练(拖拽)",
};

function currentVariant(): (typeof VARIANTS)[number] {
  const v = new URLSearchParams(window.location.search).get("variant") ?? "A";
  return (VARIANTS as readonly string[]).includes(v) ? (v as (typeof VARIANTS)[number]) : "A";
}

function setVariant(v: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("wireframe", "");
  url.searchParams.set("variant", v);
  window.history.replaceState(null, "", url);
}

export function WireframePrototype() {
  const [variant, setLocal] = useState(currentVariant);
  const isCapture = new URLSearchParams(window.location.search).has("capture");

  useEffect(() => {
    function cycle(dir: 1 | -1) {
      if (document.activeElement?.matches("input, textarea, [contenteditable]")) return;
      const i = VARIANTS.indexOf(variant);
      const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length]!;
      setVariant(next);
      setLocal(next);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  return (
    <div className="wf-root">
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      {variant === "D" && <VariantD />}
      {!isCapture && <div className="wf-switcher">
        <button
          onClick={() => {
            const i = VARIANTS.indexOf(variant);
            const next = VARIANTS[(i - 1 + VARIANTS.length) % VARIANTS.length]!;
            setVariant(next);
            setLocal(next);
          }}
          aria-label="上一个变体"
        >
          ←
        </button>
        <span>
          {variant}({LABELS[variant]})· 低保真线框,仅评审用
        </span>
        <button
          onClick={() => {
            const i = VARIANTS.indexOf(variant);
            const next = VARIANTS[(i + 1) % VARIANTS.length]!;
            setVariant(next);
            setLocal(next);
          }}
          aria-label="下一个变体"
        >
          →
        </button>
      </div>}
    </div>
  );
}

/* ===== 变体 A:工作台双栏——对话是常驻主界面,素材/策略库收进侧栏 ===== */

function VariantA() {
  return (
    <div className="wf-a">
      <aside className="wf-side">
        <div className="wf-title">电话对练</div>
        <div className="wf-btn primary">快速开始一通</div>
        <div className="wf-nav-item active">▶ 进行中的通话</div>
        <div className="wf-nav-item">素材库(2)</div>
        <div className="wf-nav-item">技能卡(3)</div>
        <div className="wf-nav-item">历史通话(4)</div>
        <div className="wf-note">主张:打开即是通话;素材是侧房,不是第一道门。</div>
      </aside>

      <main className="wf-main">
        <div className="wf-title">通话:P01 代发·资金在证券</div>
        <div className="wf-hint">第 3/12 轮 · 06:32</div>
        <div className="wf-chat">
          <div className="wf-bubble me">喂,哪位?</div>
          <div className="wf-bubble">
            您好,我是XX银行的客户经理。想跟您同步一个近期针对代发客户的活动……
          </div>
          <div className="wf-bubble me">什么活动?</div>
          <div className="wf-bubble wf-bar w60" title="AI 正在生成" />
          <div className="wf-hint">◐ 理财经理正在思考…</div>
        </div>
        <div className="wf-input">输入客户回应…… (Enter 发送)</div>
      </main>

      <aside className="wf-rail">
        <div className="wf-title">经理正在用</div>
        <div className="wf-box solid">
          <div className="wf-chip">SC1 生客开场</div>
          <div className="wf-bar w80" />
          <div className="wf-hint">当前目的:让客户确认身份,愿意继续听</div>
        </div>
        <div className="wf-title">可用策略卡</div>
        {SEED_CARDS.map((c) => (
          <div key={c.id} className="wf-box solid" style={{ marginBottom: 6 }}>
            <div className="wf-hint">{c.name}</div>
          </div>
        ))}
      </aside>
    </div>
  );
}

/* ===== 变体 B:首页卡片流——Hub 导航,每个动作是一张卡片/一个聚焦任务 ===== */

function VariantB() {
  return (
    <div className="wf-b">
      <div className="wf-topbar">
        <div className="wf-title">电话对练</div>
        <div className="wf-chip">历史通话(4)</div>
      </div>

      <div className="wf-hero">
        <div className="wf-hint">想直接练一通?</div>
        <p>
          <span className="wf-btn primary">▶ 快速开始一通电话</span>
        </p>
        <div className="wf-hint">内置生客 + 种子策略,零准备开练</div>
      </div>

      <div className="wf-title">从素材开始</div>
      <div className="wf-grid">
        <div className="wf-box solid">
          <div className="wf-title">+ 粘贴新素材</div>
          <div className="wf-hint">转写稿 → 策略卡</div>
        </div>
        <div className="wf-box solid">
          <div className="wf-title">素材01 存量生客首次触达</div>
          <div className="wf-chip">3 卡已发布</div>
          <div className="wf-bar w80" />
          <div className="wf-btn small">查看</div>
        </div>
        <div className="wf-box solid">
          <div className="wf-title">素材02 软拒绝场景</div>
          <div className="wf-chip">草稿</div>
          <div className="wf-bar w60" />
          <div className="wf-btn small">继续拆解</div>
        </div>
      </div>

      <div className="wf-title">继续上次</div>
      <div className="wf-grid">
        <div className="wf-box solid">
          <div className="wf-title">通话:P02 退休教师</div>
          <div className="wf-hint">进行到第 5/12 轮 · 昨天</div>
          <div className="wf-btn small">继续接听</div>
        </div>
        <div className="wf-box solid">
          <div className="wf-title">通话:P03 已配理财客户</div>
          <div className="wf-hint">已结束 · 查看结果</div>
          <div className="wf-btn small">结果页</div>
        </div>
      </div>
      <div className="wf-note">主张:一切从一张卡进入;流程之间互不打扰,首页回答"我现在能做什么"。</div>
    </div>
  );
}

/* ===== 变体 D:棋盘对练——策略卡/画像/产品是棋子,可拖拽布置;通话轨道是棋盘 ===== */

const D_SEED_CARDS = SEED_CARDS.map((c) => ({ id: c.id, name: c.name }));
type DPhase = "setup" | "table" | "postgame";

function currentDPhase(): DPhase {
  const phase = new URLSearchParams(window.location.search).get("phase");
  return phase === "table" || phase === "postgame" ? phase : "setup";
}

/** 变体 D 全局外壳:借鉴变体 A 的左侧栏,三幕(布置/对局/结算)共用,静态展示。 */
function DShell({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className="wf-d-shell">
      <aside className="wf-side">
        <div className="wf-title">电话对练</div>
        <div className="wf-btn primary">⚡ 快速开始一通</div>
        <div className={`wf-nav-item${active === "进行中" ? " active" : ""}`}>▶ 进行中的通话</div>
        <div className={`wf-nav-item${active === "布置" ? " active" : ""}`}>新对局(布置)</div>
        <div className="wf-nav-item">素材库(2)</div>
        <div className="wf-nav-item">技能卡(3)</div>
        <div className="wf-nav-item">历史通话(4)</div>
        <div className="wf-note">选择画像、接通电话、完成复盘，一局三幕。</div>
      </aside>
      <div className="wf-d-main">{children}</div>
    </div>
  );
}

function VariantD() {
  // 原型态:三幕全用本地状态,不连真模型。卡组机制已否决:策略卡维持"发布即全员上场",
  // 布置阶段唯一拖拽动作 = 画像入座。
  const [phase, setPhase] = useState<DPhase>(currentDPhase);
  const [seatPersona, setSeatPersona] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const persona = SEED_PERSONAS.find((p) => p.id === seatPersona);

  const phaseJump = (
    <div className="wf-d-jump">
      原型跳幕:
      <button className="wf-btn small" onClick={() => setPhase("setup")}>布置</button>
      <button className="wf-btn small" onClick={() => setPhase("table")}>对局</button>
      <button className="wf-btn small" onClick={() => setPhase("postgame")}>结算</button>
    </div>
  );

  if (phase === "setup") {
    return (
      <DShell active="布置">
      <div className="wf-d">
        <div className="wf-topbar">
          <div className="wf-title">第 1 幕 · 对局布置</div>
          {phaseJump}
        </div>
        <div className="wf-d-board">
          <div className="wf-d-hand">
            <div className="wf-title">客户画像</div>
            <div className="wf-hint">选择一位客户入座，或用默认画像快速开局</div>
            {SEED_PERSONAS.map((p) => (
              <div
                key={p.id}
                className="wf-box solid wf-card"
                draggable
                onDragStart={() => setDragged(`persona:${p.id}`)}
              >
                <div className="wf-hint">
                  {p.name}
                  {p.hidden.length > 0 && <span className="wf-chip">有隐藏牌</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="wf-d-center">
            <div
              className="wf-box wf-d-seat"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragged?.startsWith("persona:")) setSeatPersona(dragged.slice(8));
                setDragged(null);
              }}
            >
              <div className="wf-title">客户席</div>
              {persona ? (
                <div className="wf-hint">
                  已就座:{persona.name}——可见信息朝上,隐藏牌扣着
                </div>
              ) : (
                <div className="wf-hint">把一位生客拖到这里,电话接通 ▸</div>
              )}
            </div>
            <div className="wf-title">桌上的技能卡</div>
            <div className="wf-hint">AI 会根据客户回应，在对局中自动选择合适的技能</div>
            <div className="wf-d-track" style={{ marginBottom: 4 }}>
              {D_SEED_CARDS.map((c) => (
                <div key={c.id} className="wf-box solid">
                  <div className="wf-hint">{c.name}</div>
                </div>
              ))}
            </div>
            <p>
              <button
                className="wf-btn primary"
                onClick={() => persona && setPhase("table")}
              >
                ▸ 接通电话,开始对局
              </button>{" "}
              <button className="wf-btn" onClick={() => setPhase("table")}>
                ⚡ 快速开始(默认起手)
              </button>
            </p>
          </div>

          <div className="wf-d-deck">
            <div className="wf-title">产品卡(固定)</div>
            <div className="wf-box solid">
              <div className="wf-hint">拉新资金活动 · 虚拟产品事实,AI 不得用卡外信息</div>
            </div>
          </div>
        </div>
        <div className="wf-note">
          第 1 幕：选择客户画像，查看本局可用技能与产品信息，然后接通电话。
        </div>
      </div>
      </DShell>
    );
  }

  if (phase === "table") {
    return (
      <DShell active="进行中">
      <div className="wf-d">
        <div className="wf-topbar">
          <div className="wf-title">第 2 幕 · 对局</div>
          {phaseJump}
        </div>
        <div className="wf-d-board">
          <div className="wf-d-hand">
            <div className="wf-title">{persona?.name ?? "生客"}(你扮演)</div>
            <div className="wf-hint">可见信息朝上</div>
            <div className="wf-box solid">
              <div className="wf-hint">某银行代发工资客户,资金主要在证券</div>
            </div>
            <div className="wf-title">隐藏牌(扣着)</div>
            <div className="wf-box solid">
              <div className="wf-hint">? ? ?(AI 不可见,只有你知道)</div>
            </div>
          </div>

          <div className="wf-d-center">
            <div className="wf-d-track">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className={`wf-d-cell${i < 3 ? " passed" : ""}`}>
                  {i === 2 ? "♛" : ""}
                </div>
              ))}
            </div>
            <div className="wf-hint">通话轨道:经理每推进一轮走一格;12 格到底强制收口</div>
            <div className="wf-chat">
              <div className="wf-bubble me">喂,哪位?</div>
              <div className="wf-bubble">您好,我是XX银行的客户经理。想跟您同步一个近期活动……</div>
              <div className="wf-bubble me">什么活动?</div>
              <div className="wf-hint">◐ 理财经理正在思考…</div>
            </div>
            <div className="wf-input">输入客户回应…… (Enter 发送)</div>
            <p>
              <button className="wf-btn small" onClick={() => setPhase("postgame")}>
                ■ 主动收口,进入结算
              </button>
            </p>
          </div>

          <div className="wf-d-deck">
            <div className="wf-title">桌面明牌</div>
            <div className="wf-hint">经理本轮亮出的技能卡(高亮 = 正在用)</div>
            {D_SEED_CARDS.map((c, i) => (
              <div key={c.id} className={`wf-box solid${i === 0 ? " active" : ""}`}>
                <div className="wf-hint">
                  {c.name}
                  {i === 0 && <span className="wf-chip">◀ 本轮在用</span>}
                </div>
              </div>
            ))}
            <div className="wf-hint">当前目的:让客户确认身份,愿意继续听</div>
          </div>
        </div>
        <div className="wf-note">
          第 2 幕：你扮演客户回应，经理根据局势打出技能卡，通话轨道推动对局走向收口。
        </div>
      </div>
      </DShell>
    );
  }

  return (
    <DShell active="进行中">
    <div className="wf-d">
      <div className="wf-topbar">
        <div className="wf-title">第 3 幕 · 战后结算</div>
        {phaseJump}
      </div>
      <div className="wf-d-postgame">
        <div className="wf-box solid">
          <div className="wf-title">沟通结果</div>
          <div className="wf-bar w60" />
          <div className="wf-hint">逐条揭晓:结果 → 主要目标 → 收口动作(计数动效翻条)</div>
        </div>
        <div className="wf-title">策略路径(逐条翻牌回放)</div>
        <div className="wf-d-board">
          {D_SEED_CARDS.map((c) => (
            <div key={c.id} className="wf-box solid">
              <div className="wf-hint">第 {D_SEED_CARDS.indexOf(c) + 1} 轮</div>
              <div className="wf-title" style={{ fontSize: 13 }}>{c.name}</div>
              <div className="wf-bar w80" />
              <div className="wf-btn small">回放原文(跳回对话上下文)</div>
            </div>
          ))}
        </div>
        <p>
          <button className="wf-btn primary" onClick={() => setPhase("setup")}>
            ↻ 再来一局
          </button>{" "}
          <button className="wf-btn" onClick={() => setPhase("setup")}>
            换画像再来一局
          </button>
        </p>
      </div>
      <div className="wf-note">
        第 3 幕：逐条揭晓沟通结果与技能路径，像查看战报一样回到关键对话。
      </div>
    </div>
    </DShell>
  );
}

/* ===== 变体 C:单页三区连续——无导航,阶段自动折叠,输入常驻底部 ===== */

function VariantC() {
  return (
    <div className="wf-c">
      <div className="wf-title">电话对练 · 本通电话</div>
      <div className="wf-hint">模式:快速开始(P01 代发·资金在证券)</div>

      <div className="wf-zone done">
        <div className="wf-stage-dot">✓</div>
        <div className="wf-zone-body wf-box">
          <div className="wf-title">素材与策略(已发布 3 张卡)</div>
          <div className="wf-bar w60" />
          <div className="wf-hint">点开可查看 SC1–SC3 与来源片段 ▾</div>
        </div>
      </div>

      <div className="wf-zone">
        <div className="wf-stage-dot">2</div>
        <div className="wf-zone-body wf-box">
          <div className="wf-title">对话 · 第 3/12 轮</div>
          <div className="wf-bubble me">喂,哪位?</div>
          <div className="wf-bubble">您好,我是XX银行的客户经理。想跟您同步一个近期活动……</div>
          <div className="wf-bubble me">什么活动?</div>
          <div className="wf-hint">◐ 理财经理正在思考…</div>
        </div>
      </div>

      <div className="wf-zone done">
        <div className="wf-stage-dot">3</div>
        <div className="wf-zone-body wf-box">
          <div className="wf-title">结果(通话结束后解锁)</div>
          <div className="wf-bar w80" />
        </div>
      </div>

      <div className="wf-input">输入客户回应…… (Enter 发送)</div>
      <div className="wf-note">主张:一条从上到下的时间线;完成即折叠,注意力永远在当前阶段,无需导航。</div>
    </div>
  );
}
