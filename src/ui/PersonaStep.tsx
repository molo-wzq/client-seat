import { useEffect, useState } from "react";
import type { Persona } from "../domain/types";
import type { ProductApi } from "../product/product-api";

export function PersonaStep({
  api,
  onStarted,
}: {
  api: ProductApi;
  onStarted: (conversationId: string) => void;
}) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  async function start() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      onStarted((await api.startConversation(selectedId)).id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="step" aria-labelledby="persona-title">
      <h2 id="persona-title">创建一位生客</h2>
      <p className="hint">
        从预设画像开始体验。可见信息是理财经理已知的资料;隐藏信息只有你(客户)知道,
        AI 必须通过对话才能发现。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
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
              <ul>
                {persona.visible.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <h4>隐藏信息(仅你知情,AI 不可见)</h4>
              <ul>
                {persona.hidden.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </label>
        ))}
      </div>
      <div className="actions">
        <button onClick={start} disabled={busy || !selectedId}>
          开始接听
        </button>
      </div>
    </section>
  );
}
