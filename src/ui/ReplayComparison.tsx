import { useEffect, useState } from "react";
import type { ProductCore } from "../domain/product-core";
import type { ConversationResult } from "../domain/types";
import { observationFocus } from "./observation-focus";

export function ReplayComparison({ api, result }: { api: ProductCore; result: ConversationResult }) {
  const [baseline, setBaseline] = useState<ConversationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setBaseline(null);
    setError(null);
    if (result.replayOfId) {
      api.getResult(result.replayOfId).then((value) => { if (active) setBaseline(value); })
        .catch((e) => { if (active) setError((e as Error).message); });
    }
    return () => { active = false; };
  }, [api, result.replayOfId, attempt]);

  const original = baseline?.turns.filter((t) => t.speaker === "manager") ?? [];
  const current = result.turns.filter((t) => t.speaker === "manager");
  const count = Math.max(original.length, current.length);
  return <details className="replay-comparison">
    <summary>两局对照 · 原局 → 本局</summary>
    <p className="hint">按经理回应顺序并列，相同序号可能处于不同阶段。比较客户原话、经理动作与用卡；两局差异也可能来自生成变化，不能直接当作进步或因果结论。</p>
    {!baseline && !error && <p role="status">正在找回原局…</p>}
    {error && <p role="alert">原局暂不可用，可能已被存储上限清理：{error}。仍可查看本局复盘。 <button type="button" className="ghost" onClick={() => setAttempt((n) => n + 1)}>重试加载原局</button></p>}
    {baseline && <>
      <p className="hint">原局观察点：{observationFocus(baseline.observationFocus).label} · 本局观察点：{observationFocus(result.observationFocus).label}</p>
      <p className="hint">开局提示词版本：原局 {baseline.promptVersion ?? "未记录"} / 本局 {result.promptVersion ?? "未记录"}。生成规则、策略库也可能变化，以每轮记录为准。</p>
      {baseline.productFacts && result.productFacts && JSON.stringify(baseline.productFacts) !== JSON.stringify(result.productFacts) && <p className="hint">两局保存的产品参数不同，请先核对条件；此时也不能把回应变化只归因于客户话术。</p>}
      {(!baseline.productFacts || !result.productFacts) && <p className="hint">至少一局未保存当时产品参数，无法确认两局条件相同。</p>}
      {count === 0 ? <p>两局都没有经理回应；说声「喂」后再观察开场。</p> : <ol className="comparison-rounds">
        {Array.from({ length: count }, (_, index) => <li key={index}>
          <h4>经理第 {index + 1} 次回应</h4>
          <div className="comparison-pair">
            {[baseline, result].map((call, side) => {
              const manager = (side === 0 ? original : current)[index];
              const position = manager ? call.turns.findIndex((t) => t.number === manager.number) : -1;
              const customer = call.turns.slice(0, Math.max(0, position)).reverse().find((t) => t.speaker === "customer");
              const entry = call.strategyPath.find((e) => e.turnNumber === manager?.number);
              return <section key={side} aria-label={side === 0 ? `原局第${index + 1}次回应` : `本局第${index + 1}次回应`}>
                <strong>{side === 0 ? "原局" : "本局"}</strong>
                {manager ? <>
                  <p>客户：{customer?.text ?? "未记录"}</p>
                  <blockquote>{manager.text}</blockquote>
                  <p className="hint">用卡记录：{entry?.cardName ?? "未确认"} · 目的（候选）：{manager.currentGoal ?? "未记录"}</p>
                  <p className="hint">本轮生成规则版本：{manager.promptVersion ?? "旧记录未独立保存"}</p>
                  {manager.outOfCardFact && <p className="out-of-card">本轮标记卡外数字，需核对事实</p>}
                  {manager.factCheckNotes?.length ? <ul className="hint">{manager.factCheckNotes.map((note, i) => <li key={i}>事实核对（候选）：{note}</li>)}</ul> : null}
                </> : <p>本局没有这一轮，已经结束。</p>}
              </section>;
            })}
          </div>
        </li>)}
      </ol>}
    </>}
  </details>;
}
