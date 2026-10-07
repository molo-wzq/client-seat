import { useState } from "react";
import type { Conversation, Material, Persona, StrategyCard } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { MaterialStep } from "./MaterialStep";

export function MaterialsView({
  api,
  materials,
  onPublished,
}: {
  api: ProductCore;
  materials: Material[];
  onPublished: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = materials.find((m) => m.id === selectedId) ?? null;

  return (
    <section className="act" aria-labelledby="materials-title">
      <span className="act-kicker">优秀通话沉淀</span>
      <h2 id="materials-title">素材库</h2>
      {materials.length === 0 ? (
        <p className="hint">还没有素材。在下方粘贴一段优秀电话的转写稿,生成你的第一批策略卡。</p>
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
      <span className="act-kicker">已提炼的方法</span>
      <h2 id="cards-title">策略卡</h2>
      <p className="hint">已发布的卡全员上场;草稿只在所属素材里确认后才进入对局。</p>
      {cards.length === 0 ? (
        <p>还没有策略卡。</p>
      ) : (
        <div className="cards">
          {cards.map((card, i) => (
            <article key={card.id} className="card">
              <span className="card-code" aria-hidden="true">CASE / {String(i + 1).padStart(2, "0")}</span>
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
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [limit, setLimit] = useState(12);
  const dateLabel = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  };
  const rows = conversations.map((conversation) => ({
    conversation,
    name: personas.find((p) => p.id === conversation.personaId)?.name ?? "未知生客",
    date: dateLabel(conversation.createdAt),
    opening: conversation.turns.find((turn) => turn.speaker === "customer")?.text,
  })).filter(({ conversation, name, date, opening }) =>
    (status === "all" || conversation.status === status)
    && `${name} ${date} ${opening ?? ""} ${conversation.promptVersion ?? ""} ${conversation.endReason ?? ""}`
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ).sort((a, b) => {
    // 全部按时间倒序,避免旧进行中通话把新复盘挤到后页。
    return b.conversation.createdAt.localeCompare(a.conversation.createdAt);
  });
  return (
    <section className="act" aria-labelledby="history-title">
      <span className="act-kicker">往期对练</span>
      <h2 id="history-title">通话记录</h2>
      {conversations.length === 0 ? (
        <p className="hint">还没有通话。接通一通电话后会出现在这里。</p>
      ) : (
        <>
          <div className="history-toolbar">
            <label>查找通话
              <input type="search" value={query} placeholder="客户、时间或开场原话" onChange={(event) => { setQuery(event.target.value); setLimit(12); }} />
            </label>
            <label>通话状态
              <select value={status} onChange={(event) => { setStatus(event.target.value); setLimit(12); }}>
                <option value="all">全部通话</option>
                <option value="ongoing">进行中</option>
                <option value="ended">已结束</option>
              </select>
            </label>
          </div>
          <p className="hint" role="status">找到 {rows.length} 通 · 按时间倒序，可筛选进行中通话</p>
          {rows.length === 0 ? <p>没有符合条件的记录。可以更换关键词或通话状态。</p> : <ul className="catalog-list history-list">
            {rows.slice(0, limit).map(({ conversation, name, date, opening }) => (
              <li key={conversation.id}>
                <button type="button" className="catalog-item" onClick={() => void onOpen(conversation)}>
                  <span className="history-title">
                    <strong>{name}</strong>
                    <span>{date} · {conversation.turns.filter((turn) => turn.speaker === "manager").length} 轮经理回应</span>
                    {opening && <span className="history-preview">开场：{opening}</span>}
                    <span>{conversation.endReason ?? (conversation.status === "ongoing" ? "可继续通话" : "结束原因未记录")}{conversation.promptVersion ? ` · ${conversation.promptVersion}` : ""}</span>
                  </span>
                  <span className={`badge badge-${conversation.status}`}>{conversation.status === "ongoing" ? "进行中" : "已结束"}</span>
                </button>
              </li>
            ))}
          </ul>}
          {rows.length > limit && <button type="button" className="ghost" onClick={() => setLimit((current) => current + 12)}>显示更多记录（还有 {rows.length - limit} 通）</button>}
        </>
      )}
    </section>
  );
}
