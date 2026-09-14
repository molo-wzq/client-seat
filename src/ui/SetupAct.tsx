import { useState } from "react";
import { SEED_PRODUCT_CARD } from "../domain/seed";
import type { Persona, StrategyCard } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { PersonaAvatar } from "./PersonaAvatar";
import { PersonaStep } from "./PersonaStep";
import { UiIcon } from "./UiIcon";

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
  onConnect: (personaId: string) => void;
  onCatalogChange: () => void;
  connectBusy: boolean;
}) {
  const [seated, setSeated] = useState<Persona | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  // 拖拽悬停在客户席上时高亮邀请;dragleave 在经过子元素时也会触发,
  // 需确认 relatedTarget 真正离开了席位才熄灭,否则高亮会闪烁。
  const [dragOver, setDragOver] = useState(false);
  const [customizing, setCustomizing] = useState(false);

  function seat(persona: Persona) {
    setSeated(persona);
    setCustomizing(false);
  }

  return (
    <section className="act" aria-labelledby="setup-title">
      <span className="act-kicker">第一幕 / 场景准备</span>
      <h2 id="setup-title">第1幕 · 对局布置</h2>
      <p className="hint">把一位生客拖到客户席,或点击入座;快速开始会用默认生客直接接通。</p>
      <div className="setup-board">
        <div>
          <h3>生客名册</h3>
          <ul className="roster">
            {personas.map((persona, i) => (
              <li key={persona.id}>
                <button
                  type="button"
                  className={`roster-card${seated?.id === persona.id ? " seated" : ""}${dragged === persona.id ? " dragging" : ""}`}
                  draggable
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
                  {persona.hidden.length > 0 && <span className="badge"><UiIcon name="lock" />隐藏牌</span>}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ghost" onClick={() => setCustomizing(true)}>
            自定义生客
          </button>
        </div>

        <div>
          {/* 票据编号沿用名册卡口径(C-0N):入座卡与名册卡可互相对上。 */}
          <div
            className={`seat${seated ? " occupied" : ""}${dragOver ? " drag-over" : ""}`}
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
                    <h3>{seated.name}</h3>
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
              </>
            ) : (
              <>
                <span className="seat-label">等待客户入座</span>
                <h3>客户席</h3>
                <p className="hint">把一位生客拖到这里,或从名册点击入座</p>
              </>
            )}
          </div>
          <h3>桌上的策略卡(只读,全部已发布)</h3>
          <p className="hint">AI 对局中自动取用;本通不选卡。</p>
          <ul className="card-tiles">
            {publishedCards.length === 0 ? (
              <li className="hint">还没有已发布策略卡。快速开始会用种子卡兜底。</li>
            ) : (
              publishedCards.map((card) => (
                <li key={card.id} className="card-tile">
                  {card.name}
                </li>
              ))
            )}
          </ul>
          <div className="actions">
            <button onClick={() => seated && onConnect(seated.id)} disabled={connectBusy || !seated}>
              <UiIcon name="phone" />接通电话,开始对局
            </button>
          </div>
        </div>

        <div>
          <h3>产品卡(固定)</h3>
          <article className="card product-card">
            <span className="card-ribbon" aria-hidden="true">★</span>
            <span className="card-code">固定产品卡 · P-01</span>
            <strong>{SEED_PRODUCT_CARD.activity.name}</strong>
            <p className="hint">虚拟产品事实,AI 不得用卡外信息</p>
            {/* 手绘图表 doodle:呼应概念图的产品卡插画。 */}
            <svg className="product-doodle" viewBox="0 0 96 52" aria-hidden="true">
              <path d="M6 44 C 20 40 26 36 34 30 S 50 26 58 20 74 12 88 8" />
              <path d="M6 48 C 26 46 40 43 52 39 S 78 33 90 28" />
              <path d="M78 6 L88 8 L86 17" />
            </svg>
            {/* 分档权益是产品卡事实,列出便于对局时核对经理话术。 */}
            <ul className="product-tiers" aria-label="分档权益">
              {SEED_PRODUCT_CARD.activity.tiers.map((tier) => (
                <li key={tier.amount}>
                  <span>{tier.amount}</span>
                  <span>{tier.reward}</span>
                </li>
              ))}
            </ul>
            <p className="product-foot">
              {SEED_PRODUCT_CARD.activity.deadline} · {SEED_PRODUCT_CARD.flexibleProduct.name}
            </p>
          </article>
        </div>
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
