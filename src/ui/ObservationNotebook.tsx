import { useState } from 'react';
import type { ProductCore } from '../domain/product-core';
import type { Conversation, ConversationTurn, PlayerObservation } from '../domain/types';

const judgements = { addressed: '回应到了', missed: '可能遗漏', uncertain: '信息不足' } as const;

export function ObservationNotebook({ api, conversation, turn, onSaved }: {
  api: ProductCore; conversation: Conversation; turn: ConversationTurn; onSaved: (next: Conversation) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, PlayerObservation>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = conversation.observations?.find((note) => note.managerTurnNumber === turn.number);
  const draft = drafts[turn.number] ?? saved ?? { managerTurnNumber: turn.number, evidence: '', nextExperiment: '', revealed: false, marked: false };
  function update(patch: Partial<PlayerObservation>) { setDrafts((all) => ({ ...all, [turn.number]: { ...draft, ...patch } })); }
  async function save(reveal: boolean) {
    if (busy) return;
    const target = turn.number;
    // 本地草稿可能早于刚盖的体感戳:保存时以最新落库的戳兜底,不让文字保存洗掉印章。
    const latestFeeling = conversation.observations?.find((item) => item.managerTurnNumber === target)?.feeling;
    const note: PlayerObservation = {
      ...draft,
      ...(draft.feeling ? {} : latestFeeling ? { feeling: latestFeeling } : {}),
      revealed: reveal || draft.revealed,
    };
    setBusy(true); setError(null);
    try {
      const next = await api.saveObservation(conversation.id, note);
      setDrafts((all) => { const copy = { ...all }; delete copy[target]; return copy; });
      onSaved(next);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <aside className="observation-notebook" aria-label="先判断，再看解释">
    <h3>先判断，再看解释 · T{turn.number}</h3>
    <p>经理接住了哪项顾虑？找一句依据；也可以先保留疑问。这些是你的观察，不评价客户表现。</p>
    <fieldset disabled={busy}><legend>我的判断</legend>
      {Object.entries(judgements).map(([value, label]) => <label key={value}><input type="radio" name={`judgement-${conversation.id}-${turn.number}`} checked={draft.judgement === value} onChange={() => update({ judgement: value as PlayerObservation['judgement'] })} />{label}</label>)}
    </fieldset>
    <label htmlFor={`observation-evidence-${turn.number}`}>原话中的依据</label>
    <textarea id={`observation-evidence-${turn.number}`} rows={2} value={draft.evidence} maxLength={2000} disabled={busy} onChange={(event) => update({ evidence: event.target.value })} placeholder="引用一句回应，或写下还缺什么信息" />
    <label htmlFor={`observation-next-${turn.number}`}>下一次只改变什么？</label>
    <input id={`observation-next-${turn.number}`} value={draft.nextExperiment} maxLength={2000} disabled={busy} onChange={(event) => update({ nextExperiment: event.target.value })} placeholder="例如：提前说明取用时间" />
    <label><input type="checkbox" checked={draft.marked} disabled={busy} onChange={(event) => update({ marked: event.target.checked })} />把这一轮留作复盘重点</label>
    {error && <p role="alert">{error}</p>}
    {drafts[turn.number] && <p className="hint">观察尚未保存；保存后会进入本局复盘。</p>}
    <div className="actions">
      <button type="button" disabled={busy || (!draft.evidence.trim() && !draft.judgement && !draft.marked && !draft.nextExperiment.trim())} onClick={() => void save(true)}>保存观察，查看解释</button>
      {!saved?.revealed && <button type="button" className="ghost" disabled={busy} onClick={() => void save(true)}>先查看解释</button>}
      {saved?.revealed && <span role="status">解释已展开，观察可继续补充</span>}
    </div>
  </aside>;
}
