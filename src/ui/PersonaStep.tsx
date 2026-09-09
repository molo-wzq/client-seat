import { useState } from "react";
import type { Persona } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { BusyHint } from "./BusyHint";
import { useBusyTask } from "./use-busy-task";

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

/** 自定义生客编辑器:画像列表由布置幕传入(目录已加载),保存后经 onSaved 通知父级刷新。 */
export function PersonaStep({
  api,
  personas,
  onSaved,
}: {
  api: ProductCore;
  personas: Persona[];
  onSaved?: (persona: Persona) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(() => personas[0]?.id ?? null);
  const [editing, setEditing] = useState<{ name: string; lines: PersonaLine[] } | null>(null);
  const { busy, busyHint, error, run } = useBusyTask("正在保存画像…");

  const selected = personas.find((p) => p.id === selectedId) ?? null;

  async function saveCustomPersona(): Promise<Persona> {
    if (!editing) throw new Error("没有正在编辑的画像");
    const saved = await api.savePersona({
      name: editing.name,
      visible: editing.lines.filter((line) => !line.hidden).map((line) => line.text),
      hidden: editing.lines.filter((line) => line.hidden).map((line) => line.text),
    });
    setSelectedId(saved.id);
    setEditing(null);
    onSaved?.(saved);
    return saved;
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
      {busy && <BusyHint text={busyHint} />}

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
            <button type="button" onClick={() => run(async () => void (await saveCustomPersona()))} disabled={busy}>
              保存为我的生客
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
            type="button"
            className="ghost"
            onClick={() =>
              selected &&
              setEditing({ name: selected.name, lines: personaToLines(selected) })
            }
            disabled={busy || !selected}
          >
            修改属性
          </button>
        </div>
      )}
    </section>
  );
}
