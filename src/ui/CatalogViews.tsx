import { useState } from "react";
import type { Conversation, Material, Persona, StrategyCard } from "../domain/types";
import type { ProductApi } from "../product/product-api";
import { MaterialStep } from "./MaterialStep";

export function MaterialsView({
  api,
  materials,
  onPublished,
}: {
  api: ProductApi;
  materials: Material[];
  onPublished: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = materials.find((m) => m.id === selectedId) ?? null;

  return (
    <section className="act" aria-labelledby="materials-title">
      <h2 id="materials-title">素材库</h2>
      {materials.length === 0 ? (
        <p className="hint">还没有素材。可在布置幕侧栏粘贴转写稿,或在下方直接分析。</p>
      ) : (
        <ul className="catalog-list">
          {materials.map((material) => (
            <li key={material.id}>
              <button
                type="button"
                className={selectedId === material.id ? "catalog-item current" : "catalog-item"}
                onClick={() => setSelectedId(material.id)}
              >
                {material.title}
                <span className="hint-inline">
                  {material.kind ?? "未分类"} · {material.cards.filter((c) => c.status === "published").length} 张已发布
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={selectedId === null ? "catalog-item current" : "catalog-item"}
              onClick={() => setSelectedId(null)}
            >
              + 粘贴新素材
            </button>
          </li>
        </ul>
      )}
      <MaterialStep
        key={selected?.id ?? "new"}
        api={api}
        initialMaterial={selected}
        onPublished={(material) => {
          setSelectedId(material.id);
          onPublished();
        }}
      />
    </section>
  );
}

export function CardsView({ cards }: { cards: StrategyCard[] }) {
  return (
    <section className="act" aria-labelledby="cards-title">
      <h2 id="cards-title">策略卡</h2>
      <p className="hint">已发布的卡全员上场;草稿只在所属素材里确认后才进入对局。</p>
      {cards.length === 0 ? (
        <p>还没有策略卡。</p>
      ) : (
        <div className="cards">
          {cards.map((card) => (
            <article key={card.id} className="card">
              <header>
                <strong>{card.name}</strong>
                <span className={`badge badge-${card.status}`}>{card.status === "draft" ? "草稿" : "已发布"}</span>
              </header>
              <p className="hint">
                {card.currentPurpose}
                {card.sourceExcerpt.materialTitle ? ` · 来自 ${card.sourceExcerpt.materialTitle}` : ""}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function HistoryView({
  conversations,
  personas,
  onOpen,
}: {
  conversations: Conversation[];
  personas: Persona[];
  onOpen: (conversation: Conversation) => void | Promise<void>;
}) {
  const ended = conversations.filter((c) => c.status === "ended");
  return (
    <section className="act" aria-labelledby="history-title">
      <h2 id="history-title">历史通话</h2>
      {ended.length === 0 ? (
        <p className="hint">还没有结束的通话。</p>
      ) : (
        <ul className="catalog-list">
          {ended.map((conversation) => {
            const persona = personas.find((p) => p.id === conversation.personaId);
            return (
              <li key={conversation.id}>
                <button type="button" className="catalog-item" onClick={() => void onOpen(conversation)}>
                  {persona?.name ?? "未知生客"}
                  <span className="hint-inline">{conversation.endReason ?? "已结束"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
