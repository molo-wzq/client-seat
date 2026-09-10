/**
 * 低保真线框原型(throwaway,不进生产)。
 *
 * 问题:电话对练前端整体信息架构/流程应怎么组织?(用户反馈:整体逻辑存在问题)
 * 历史:2026-09-09 曾以 A/B/C/D 四变体线框评审;变体 D「棋盘对练三幕」胜出并已实装,
 *       A/B/C 与 D 是同一批界面的重复草稿,已删除。本文件收敛为已实装方向的单一参照:
 *       静态假数据、不连真模型,仅 dev 模式 ?wireframe 可见,?phase=setup|table|postgame 深链。
 *       导航统一走左栏(与实机同构);评审期的重复入口(布置幕桌面快速开始、跳幕按钮)已去除。
 */
import { useState, type ReactNode } from "react";
import { SEED_CARDS, SEED_PERSONAS } from "../../domain/seed";
import "./wireframe.css";

type Phase = "setup" | "table" | "postgame";

function currentPhase(): Phase {
  const phase = new URLSearchParams(window.location.search).get("phase");
  return phase === "table" || phase === "postgame" ? phase : "setup";
}

const TABLE_CARDS = SEED_CARDS.map((c) => ({ id: c.id, name: c.name }));

export function WireframePrototype() {
  const [phase, setPhase] = useState<Phase>(currentPhase);
  const [seated, setSeated] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const persona = SEED_PERSONAS.find((p) => p.id === seated) ?? null;

  return (
    <div className="wf-root">
      <Shell active={phase} onNavigate={setPhase}>
        {phase === "setup" && (
          <SetupAct
            persona={persona}
            dragged={dragged}
            onDrag={setDragged}
            onSeat={setSeated}
            onConnect={() => setPhase("table")}
          />
        )}
        {phase === "table" && <TableAct persona={persona} onFinish={() => setPhase("postgame")} />}
        {phase === "postgame" && <PostgameAct onRestart={() => setPhase("setup")} />}
      </Shell>
    </div>
  );
}

/** 全局外壳:常驻左栏 = 我有什么;主区 = 正在打的这一局(三幕之一)。幕间导航只走左栏。 */
function Shell({
  active,
  onNavigate,
  children,
}: {
  active: Phase;
  onNavigate: (phase: Phase) => void;
  children: ReactNode;
}) {
  return (
    <div className="wf-d-shell">
      <aside className="wf-side">
        <div className="wf-title">电话对练</div>
        <div className="wf-btn primary">⚡ 快速开始一通</div>
        <button
          type="button"
          className={`wf-nav-item${active !== "setup" ? " active" : ""}`}
          onClick={() => onNavigate("table")}
        >
          ▶ 进行中的通话
        </button>
        <button
          type="button"
          className={`wf-nav-item${active === "setup" ? " active" : ""}`}
          onClick={() => onNavigate("setup")}
        >
          新对局(布置)
        </button>
        <div className="wf-nav-item">素材库(2)</div>
        <div className="wf-nav-item">技能卡(3)</div>
        <div className="wf-nav-item">历史通话(4)</div>
        <div className="wf-note">左栏是你有的东西,主区是正在打的这一局;选择画像、接通电话、完成复盘,一局三幕。</div>
      </aside>
      <div className="wf-d-main">{children}</div>
    </div>
  );
}

/* ===== 第 1 幕 · 布置:画像入座是唯一准备动作,接通即开局 ===== */

function SetupAct({
  persona,
  dragged,
  onDrag,
  onSeat,
  onConnect,
}: {
  persona: (typeof SEED_PERSONAS)[number] | null;
  dragged: string | null;
  onDrag: (id: string | null) => void;
  onSeat: (id: string | null) => void;
  onConnect: () => void;
}) {
  return (
    <div className="wf-d">
      <div className="wf-topbar">
        <div className="wf-title">第 1 幕 · 对局布置</div>
      </div>
      <div className="wf-d-board">
        <div className="wf-d-hand">
          <div className="wf-title">客户画像</div>
          <div className="wf-hint">选择一位客户入座</div>
          {SEED_PERSONAS.map((p) => (
            <div
              key={p.id}
              className="wf-box solid wf-card"
              draggable
              onDragStart={() => onDrag(`persona:${p.id}`)}
              onClick={() => onSeat(p.id)}
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
              if (dragged?.startsWith("persona:")) onSeat(dragged.slice(8));
              onDrag(null);
            }}
          >
            <div className="wf-title">客户席</div>
            {persona ? (
              <div className="wf-hint">已就座:{persona.name}——可见信息朝上,隐藏牌扣着</div>
            ) : (
              <div className="wf-hint">把一位生客拖到这里,电话接通 ▸</div>
            )}
          </div>
          <div className="wf-title">桌上的技能卡</div>
          <div className="wf-hint">发布即全员上场;AI 对局中自动选择,本通不选卡</div>
          <div className="wf-d-track" style={{ marginBottom: 4 }}>
            {TABLE_CARDS.map((c) => (
              <div key={c.id} className="wf-box solid">
                <div className="wf-hint">{c.name}</div>
              </div>
            ))}
          </div>
          <p>
            <button className="wf-btn primary" onClick={() => persona && onConnect()}>
              ▸ 接通电话,开始对局
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
      <div className="wf-note">第 1 幕:选择客户画像,查看本局可用技能与产品信息,然后接通电话。</div>
    </div>
  );
}

/* ===== 第 2 幕 · 对局:轨道 + 对话 + 明牌 ===== */

function TableAct({ persona, onFinish }: { persona: (typeof SEED_PERSONAS)[number] | null; onFinish: () => void }) {
  return (
    <div className="wf-d">
      <div className="wf-topbar">
        <div className="wf-title">第 2 幕 · 对局</div>
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
            <button className="wf-btn small" onClick={onFinish}>
              ■ 主动收口,进入结算
            </button>
          </p>
        </div>

        <div className="wf-d-deck">
          <div className="wf-title">桌面明牌</div>
          <div className="wf-hint">经理本轮亮出的技能卡(高亮 = 正在用)</div>
          {TABLE_CARDS.map((c, i) => (
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
      <div className="wf-note">第 2 幕:你扮演客户回应,经理根据局势打出技能卡,通话轨道推动对局走向收口。</div>
    </div>
  );
}

/* ===== 第 3 幕 · 结算:逐条揭晓 + 回放 ===== */

function PostgameAct({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="wf-d">
      <div className="wf-topbar">
        <div className="wf-title">第 3 幕 · 战后结算</div>
      </div>
      <div className="wf-d-postgame">
        <div className="wf-box solid">
          <div className="wf-title">沟通结果</div>
          <div className="wf-bar w60" />
          <div className="wf-hint">逐条揭晓:结果 → 主要目标 → 收口动作(计数动效翻条)</div>
        </div>
        <div className="wf-title">策略路径(逐条翻牌回放)</div>
        <div className="wf-d-board">
          {TABLE_CARDS.map((c, i) => (
            <div key={c.id} className="wf-box solid">
              <div className="wf-hint">第 {i + 1} 轮</div>
              <div className="wf-title" style={{ fontSize: 13 }}>
                {c.name}
              </div>
              <div className="wf-bar w80" />
              <div className="wf-btn small">回放原文(跳回对话上下文)</div>
            </div>
          ))}
        </div>
        <p>
          <button className="wf-btn primary" onClick={onRestart}>
            ↻ 再来一局
          </button>{" "}
          <button className="wf-btn" onClick={onRestart}>
            换画像再来一局
          </button>
        </p>
      </div>
      <div className="wf-note">第 3 幕:逐条揭晓沟通结果与技能路径,像查看战报一样回到关键对话。</div>
    </div>
  );
}
