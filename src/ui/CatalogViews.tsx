import { useState } from "react";
import type { Conversation, Material, Persona, StrategyCard } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import type { RoleCard } from "../domain/role-card";
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

/**
 * 经理角色卡列表:一整套打法(人设、钱规律、通话规则、示范话术、尾部提醒)
 * 随卡携带,行内创建、更换、流通——导出 JSON 发给同事,导入即用。
 */
export function RolesView({
  api,
  roles,
  onRolesChange,
}: {
  api: ProductCore;
  roles: RoleCard[];
  onRolesChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canImport = typeof api.saveRole === "function";

  function exportRole(role: RoleCard) {
    const blob = new Blob([JSON.stringify(role, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `经理角色-${role.name}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importRole(file: File) {
    setBusy(true);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      await api.saveRole(parsed);
      onRolesChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="act" aria-labelledby="roles-title">
      <span className="act-kicker">可更换的打法体系</span>
      <h2 id="roles-title">经理角色</h2>
      <p className="hint">布置幕选谁上桌,谁的人设、规律、规则与示范话术就随局生效;开局后按当时的卡快照复盘。</p>
      {error && <p role="alert">{error}</p>}
      <div className="cards">
        {roles.map((role) => (
          <article key={role.id} className="card">
            <header>
              <strong>{role.name}</strong>
              <span className="badge">{role.tags.join("·") || "自定义"}</span>
            </header>
            <p className="hint">
              {role.callLogic.length} 条钱规律 · {role.rules.length} 条通话规则 · v{role.characterVersion}
            </p>
            {role.personality && <p className="hint">{role.personality}</p>}
            <details>
              <summary>看这套打法</summary>
              <p className="hint">{role.callLogicIntro}</p>
              <ul>
                {role.callLogic.map((law) => (
                  <li key={law.key}>{law.name} — {law.law}</li>
                ))}
              </ul>
              <p className="hint">示范开场:{role.firstMes}</p>
            </details>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => exportRole(role)}>导出 JSON</button>
            </div>
          </article>
        ))}
      </div>
      {canImport && (
        <div className="actions">
          <label className="ghost import-role">
            导入角色卡 JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importRole(file);
                event.target.value = "";
              }}
            />
          </label>
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

/**
 * 完整投研周报浏览视图:
 * 在线浏览 14 章专业研报，支持一键下载完整 HTML/PDF 文件。
 */
export function ResearchReportView() {
  function downloadFullReport() {
    window.open("/api/research/download", "_blank");
  }

  return (
    <section className="act" aria-labelledby="research-title">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span className="act-kicker">分行投研周报</span>
          <h2 id="research-title">周度投研分析报告 (2026年第42周)</h2>
          <p className="hint">覆盖宏观仪表盘、A股全景、行业轮动、机构估值、精选公募池与下周展望。</p>
        </div>
        <button
          type="button"
          onClick={downloadFullReport}
          style={{
            background: "#d4af37",
            color: "#1c261e",
            fontWeight: "bold",
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
          }}
        >
          📥 下载完整周报 (HTML)
        </button>
      </div>

      <div style={{ marginTop: "16px", border: "1px solid var(--line)", borderRadius: "8px", overflow: "hidden", background: "#fff", height: "780px" }}>
        <iframe
          src="/reports/weekly-report.html"
          title="周度投研分析报告全文"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </div>
    </section>
  );
}
