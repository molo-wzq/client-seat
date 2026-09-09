import { useState } from "react";
import { SEED_PRODUCT_CARD } from "../domain/seed";
import type { Persona, StrategyCard } from "../domain/types";
import type { ProductApi } from "../product/product-api";
import { PersonaStep } from "./PersonaStep";

export function SetupAct({
  api,
  personas,
  publishedCards,
  onConnect,
  onCatalogChange,
  connectBusy,
}: {
  api: ProductApi;
  personas: Persona[];
  publishedCards: StrategyCard[];
  onConnect: (personaId: string) => void;
  onCatalogChange: () => void;
  connectBusy: boolean;
}) {
  const [seated, setSeated] = useState<Persona | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);

  function seat(persona: Persona) {
    setSeated(persona);
    setCustomizing(false);
  }

  return (
    <section className="act" aria-labelledby="setup-title">
      <h2 id="setup-title">第 1 幕 · 对局布置</h2>
      <p className="hint">把一位生客拖到客户席,或点击入座;快速开始会用默认生客直接接通。</p>
      <div className="setup-board">
        <div>
          <h3>生客名册</h3>
          <ul className="roster">
            {personas.map((persona) => (
              <li key={persona.id}>
                <button
                  type="button"
                  className={`roster-card${seated?.id === persona.id ? " seated" : ""}`}
                  draggable
                  onDragStart={() => setDragged(persona.id)}
                  onClick={() => seat(persona)}
                >
                  {persona.name}
                  {persona.hidden.length > 0 && <span className="badge">有隐藏牌</span>}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ghost" onClick={() => setCustomizing(true)}>
            自定义生客
          </button>
        </div>

        <div>
          <div
            className="seat"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const dropped = personas.find((p) => p.id === dragged);
              if (dropped) seat(dropped);
              setDragged(null);
            }}
          >
            <h3>客户席</h3>
            {seated ? (
              <p>
                已就座:{seated.name}——可见信息朝上,隐藏牌扣着
              </p>
            ) : (
              <p className="hint">把一位生客拖到这里,或从名册点击入座</p>
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
              接通电话,开始对局
            </button>
          </div>
        </div>

        <div>
          <h3>产品卡(固定)</h3>
          <article className="card">
            <strong>{SEED_PRODUCT_CARD.activity.name}</strong>
            <p className="hint">虚拟产品事实,AI 不得用卡外信息</p>
            <p>
              {SEED_PRODUCT_CARD.activity.deadline} · {SEED_PRODUCT_CARD.flexibleProduct.name}
            </p>
          </article>
        </div>
      </div>
      {customizing && (
        <PersonaStep
          api={api}
          onSaved={(persona) => {
            seat(persona);
            onCatalogChange();
          }}
        />
      )}
    </section>
  );
}
