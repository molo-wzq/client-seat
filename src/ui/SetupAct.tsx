import { useEffect, useRef, useState } from "react";
import type { ObservationFocus, Persona, StrategyCard } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { PersonaAvatar } from "./PersonaAvatar";
import { PersonaStep } from "./PersonaStep";
import { UiIcon } from "./UiIcon";
import { LogicRail } from "./TavernRail";
import { OBSERVATION_FOCI, observationFocus } from "./observation-focus";
import "./frontend-lenses.css";

export function SetupAct({
  api,
  personas,
  publishedCards,
  onConnect,
  onCatalogChange,
  connectBusy,
}: {
  api: ProductCore;
  personas: Persona[];
  publishedCards: StrategyCard[];
  onConnect: (personaId: string, focus: ObservationFocus) => void;
  onCatalogChange: () => void;
  connectBusy: boolean;
}) {
  const [seated, setSeated] = useState<Persona | null>(null);
  const [focus, setFocus] = useState<ObservationFocus>("signals");
  const [dragged, setDragged] = useState<string | null>(null);
  // 拖拽悬停在客户席上时高亮邀请;dragleave 在经过子元素时也会触发,
  // 需确认 relatedTarget 真正离开了席位才熄灭,否则高亮会闪烁。
  const [dragOver, setDragOver] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const seatRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!seated || !window.matchMedia?.("(max-width: 820px)").matches) return;
    seatRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
    seatRef.current?.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
  }, [seated]);

  function seat(persona: Persona) {
    if (connectBusy) return;
    setSeated(persona);
    setCustomizing(false);
  }

  return (
    <section className="act" aria-labelledby="setup-title">
      <span className="act-kicker">第一幕 / 场景准备</span>
      <h2 id="setup-title">第1幕 · 对局布置</h2>
      <p className="hint">选一位客户入座，读画像，再接通电话。</p>
      <aside className="play-guide" aria-label="怎么玩">
        <div>
        <strong>你是客户，AI 是理财经理</strong>
        <p>按画像自然回应，观察经理怎样接话；拒绝、追问和提前结束都可以。</p>
        </div>
        <details>
        <summary>第一次玩？查看三个步骤</summary>
        <ol>
          <li>选客户，读画像</li>
          <li>说声「喂」，开始通话</li>
          <li>复盘打法，换个回应再试</li>
        </ol>
        <p>不需要配合成交，也不必打满回合；拒绝和提前结束同样能留下有用的复盘。</p>
        <p>隐藏牌不用一次说完，等聊到相关话题再决定透露。</p>
        </details>
      </aside>
      <div className="setup-board">
        <div>
          <h3>生客名册</h3>
          <ul className="roster">
            {personas.map((persona, i) => (
              <li key={persona.id}>
                <button
                  type="button"
                  className={`roster-card${seated?.id === persona.id ? " seated" : ""}${dragged === persona.id ? " dragging" : ""}`}
                  draggable={!connectBusy}
                  aria-pressed={seated?.id === persona.id}
                  disabled={connectBusy}
                  onDragStart={() => setDragged(persona.id)}
                  onDragEnd={() => setDragged(null)}
                  onClick={() => seat(persona)}
                >
                  <PersonaAvatar personaId={persona.id} name={persona.name} />
                  <span className="roster-copy">
                    <strong>{persona.name}</strong>
                    <small>{persona.visible[0] ?? "信息未知"}</small>
                  </span>
                  <span className="roster-code" aria-hidden="true">C-{String(i + 1).padStart(2, "0")}</span>
                  <span className="badge">{seated?.id === persona.id ? "✓ 已入座" : persona.hidden.length > 0 ? <><UiIcon name="lock" />隐藏牌</> : "点击入座"}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ghost" disabled={connectBusy} onClick={() => setCustomizing(true)}>
            自定义生客
          </button>
        </div>

        <div>
          {/* 票据编号沿用名册卡口径(C-0N):入座卡与名册卡可互相对上。 */}
          <div
            className={`seat${seated ? " occupied" : ""}${dragOver ? " drag-over" : ""}`}
            ref={seatRef}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
            }}
            onDrop={() => {
              setDragOver(false);
              const dropped = personas.find((p) => p.id === dragged);
              if (dropped) seat(dropped);
              setDragged(null);
            }}
          >
            {seated ? (
              <>
                <span className="seat-label">客户席 · 已入座</span>
                <div className="seated-client">
                  <PersonaAvatar personaId={seated.id} name={seated.name} />
                  <div className="seated-copy">
                    <h3 tabIndex={-1}>{seated.name}</h3>
                    <span className="seated-legend">
                      <i className="dot dot-vis" aria-hidden="true" />
                      可见信息朝上 · AI 可见
                    </span>
                    <span className="seated-legend">
                      <i className="dot dot-hid" aria-hidden="true" />
                      隐藏牌扣着{seated.hidden.length > 0 ? ` · ${seated.hidden.length} 张` : " · 无"}
                    </span>
                  </div>
                  <span className="seat-stamp" aria-hidden="true">已入座</span>
                  <span className="roster-code seat-code" aria-hidden="true">
                    {(() => {
                      const index = personas.findIndex((p) => p.id === seated.id);
                      return `SEAT · C-${String(index >= 0 ? index + 1 : 0).padStart(2, "0")}`;
                    })()}
                  </span>
                </div>
                <div className="seat-preview">
                  <h4>经理已知</h4>
                  <ul className="info-list">
                    {(seated.visible.length ? seated.visible : ["未知，经理需要通过对话了解"]).map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                  <details key={seated.id}>
                    <summary>查看你的隐藏牌 · 仅你知情</summary>
                    <ul className="info-list">
                      {(seated.hidden.length ? seated.hidden : ["本画像没有隐藏信息"]).map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  </details>
                </div>
              </>
            ) : (
              <>
                <span className="seat-label">等待客户入座</span>
                <h3>客户席</h3>
                <p className="hint">把一位生客拖到这里,或从名册点击入座</p>
              </>
            )}
          </div>
          <fieldset className="observation-picker" disabled={connectBusy}>
            <legend>这局想观察什么？</legend>
            <div className="quick-chips">
              {OBSERVATION_FOCI.map((option) => <label key={option.id}>
                <input type="radio" name="observation-focus" value={option.id} checked={focus === option.id} onChange={() => setFocus(option.id)} />
                {option.label}
              </label>)}
            </div>
            <p>{observationFocus(focus).question}</p>
            <small>只帮助你聚焦；不向经理透露，不要求你配合成交。</small>
          </fieldset>
          <div className="actions connect-actions">
            <button onClick={() => seated && onConnect(seated.id, focus)} disabled={connectBusy || !seated}>
              <UiIcon name="phone" />{connectBusy ? "正在接通…" : "接通电话,开始对局"}
            </button>
            <small>{seated ? `已入座：${seated.name}` : "先从名册选一位客户"}</small>
          </div>
          <details className="setup-deck-reference">
          <summary>策略明牌 · {publishedCards.length} 张已发布，全部上桌</summary>
          <h3>桌上的策略卡(只读,全部已发布)</h3>
          <p className="hint">AI 对局中自动取用;本通不选卡。</p>
          <ul className="card-tiles">
            {publishedCards.length === 0 ? (
              <li className="hint">还没有已发布策略卡。直接接通会按一般服务原则回应；快速开始会用种子卡兜底。</li>
            ) : (
              publishedCards.map((card) => (
                <li key={card.id} className="card-tile">
                  {card.name}
                </li>
              ))
            )}
          </ul>
          </details>
        </div>

        <details className="setup-reference">
          <summary>桌边参考 · 四条通话逻辑与本局参数</summary>
          <LogicRail />
        </details>
      </div>
      {customizing && (
        <PersonaStep
          api={api}
          personas={personas}
          onSaved={(persona) => {
            seat(persona);
            onCatalogChange();
          }}
        />
      )}
    </section>
  );
}
