import { useEffect, useState } from "react";
import type { Persona } from "../domain/types";
import type { ProductApi } from "../product/product-api";

/** 画像编辑中的一条属性:用户决定它对 AI 理财经理是否可见。 */
interface PersonaLine {
  text: string;
  hidden: boolean;
}

function personaToLines(persona: Persona): PersonaLine[] {
  return [
    ...persona.visible.map((text) => ({ text, hidden: false })),
    ...persona.hidden.map((text) => ({ text, hidden: true })),
  ];
}

export function PersonaStep({
  api,
  onStarted,
}: {
  api: ProductApi;
  onStarted: (conversationId: string) => void;
}) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ name: string; lines: PersonaLine[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listPersonas()
      .then((list) => {
        if (cancelled) return;
        setPersonas(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const selected = personas.find((p) => p.id === selectedId) ?? null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomPersona(): Promise<Persona> {
    if (!editing) throw new Error("没有正在编辑的画像");
    const saved = await api.savePersona({
      name: editing.name,
      visible: editing.lines.filter((line) => !line.hidden).map((line) => line.text),
      hidden: editing.lines.filter((line) => line.hidden).map((line) => line.text),
    });
    setPersonas((current) => [...current, saved]);
    setSelectedId(saved.id);
    setEditing(null);
    return saved;
  }

  async function saveAndStart() {
    await run(async () => {
      const saved = await saveCustomPersona();
      onStarted((await api.startConversation(saved.id)).id);
    });
  }

  async function start() {
    if (!selected) return;
    await run(async () => {
      onStarted((await api.startConversation(selected.id)).id);
    });
  }

  return (
    <section className="step" aria-labelledby="persona-title">
      <h2 id="persona-title">创建一位生客</h2>
      <p className="hint">
        从预设画像开始体验,也可以修改属性保存为你自己的生客。可见信息是理财经理已知的资料;
        隐藏信息只有你(客户)知道,AI 必须通过对话才能发现。留空的属性保持未知,系统不会补全。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {!editing && (
        <div className="persona-list">
          {personas.map((persona) => (
            <label key={persona.id} className={`persona ${selectedId === persona.id ? "selected" : ""}`}>
              <input
                type="radio"
                name="persona"
                value={persona.id}
                checked={selectedId === persona.id}
                onChange={() => setSelectedId(persona.id)}
              />
              <div>
                <h3>{persona.name}</h3>
                <h4>可见信息(理财经理已知)</h4>
                {persona.visible.length ? (
                  <ul>
                    {persona.visible.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="unknown-note">未知(经理将在对话中发现)</p>
                )}
                <h4>隐藏信息(仅你知情,AI 不可见)</h4>
                {persona.hidden.length ? (
                  <ul>
                    {persona.hidden.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="unknown-note">无</p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {editing && (
        <div className="persona-editor">
          <label>
            生客称呼
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <p className="hint">每行一条属性;勾选「隐藏」表示只有客户知道,AI 不可见。</p>
          {editing.lines.map((line, index) => (
            <div key={index} className="persona-line">
              <input
                aria-label={`属性${index + 1}`}
                value={line.text}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    lines: editing.lines.map((l, i) => (i === index ? { ...l, text: e.target.value } : l)),
                  })
                }
              />
              <label className="line-hidden-toggle">
                <input
                  type="checkbox"
                  checked={line.hidden}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      lines: editing.lines.map((l, i) =>
                        i === index ? { ...l, hidden: e.target.checked } : l,
                      ),
                    })
                  }
                />
                隐藏
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  setEditing({ ...editing, lines: editing.lines.filter((_, i) => i !== index) })
                }
                disabled={busy}
              >
                删除
              </button>
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setEditing({ ...editing, lines: [...editing.lines, { text: "", hidden: false }] })}
              disabled={busy}
            >
              + 添加属性
            </button>
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={() => run(async () => void (await saveCustomPersona()))}
              disabled={busy}
            >
              保存为我的生客
            </button>
            <button type="button" onClick={saveAndStart} disabled={busy}>
              保存并开始接听
            </button>
            <button type="button" className="ghost" onClick={() => setEditing(null)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="actions">
          <button
            className="ghost"
            onClick={() =>
              selected &&
              setEditing({ name: selected.name, lines: personaToLines(selected) })
            }
            disabled={busy || !selected}
          >
            修改属性
          </button>
          <button onClick={start} disabled={busy || !selected}>
            开始接听
          </button>
        </div>
      )}
    </section>
  );
}
