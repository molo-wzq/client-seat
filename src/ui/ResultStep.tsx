import { useEffect, useRef, useState } from "react";
import type { ConversationResult } from "../domain/types";
import { CALL_LOGIC_LAWS } from "../domain/call-logic";
import { playSfx } from "./game-feel";

export function ResultStep({
  result,
  onRestart,
}: {
  result: ConversationResult;
  onRestart: () => void;
}) {
  // 回放原文时在完整对话里闪烁定位目标轮次;同轮连续点击也要能重触发,
  // 所以先清空再在下一帧置回,动画由 CSS 的 li.flash 承担。
  const [flashTurn, setFlashTurn] = useState<number | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // 盖章音效对齐 stamp-slam 的砸落帧(动画延迟 220ms、约 55% 处着桌)。
  useEffect(() => {
    const t = window.setTimeout(() => playSfx("stamp"), 450);
    return () => window.clearTimeout(t);
  }, []);

  function scrollToTurn(turnNumber: number) {
    document.getElementById(`result-turn-${turnNumber}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.clearTimeout(flashTimer.current);
    setFlashTurn(null);
    requestAnimationFrame(() => setFlashTurn(turnNumber));
    flashTimer.current = window.setTimeout(() => setFlashTurn(null), 1800);
  }

  // 逐经理轮的复盘链:客户本轮原话 → 系统识别信号/目的 → 策略卡 → 实际回应 → 来源。
  // 未匹配到卡的经理轮同样进列表,如实显示"未确认",不为复盘完整硬配一张卡。
  const managerTurns = result.turns.filter((t) => t.speaker === "manager");
  const entriesByTurn = new Map(result.strategyPath.map((e) => [e.turnNumber, e]));

  return (
    <section className="step result-act" aria-labelledby="result-title">
      <span className="act-kicker">第三幕 / 对局复盘</span>
      <div className="result-heading">
        <div>
          <h2 id="result-title">这通电话是怎样推进的</h2>
          <p className="hint">只解释 AI 的打法,不评价你的客户表现。</p>
        </div>
        <span className="result-stamp" aria-hidden="true">本局<br />已复盘</span>
      </div>

      <dl className="result-summary">
        <div>
          <dt>本轮主要目标</dt>
          <dd>{result.mainGoal}</dd>
        </div>
        <div>
          <dt>沟通结果</dt>
          <dd>{result.outcome}</dd>
        </div>
        <div>
          <dt>结束原因</dt>
          <dd>{result.endReason}</dd>
        </div>
      </dl>

      <h3>打法复盘(每一轮:客户原话 → 识别信号 → 策略卡 → 经理回应 → 素材来源)</h3>
      <p className="hint">
        信号、目的与用卡为系统在话术生成后的解释候选,以实际话术与素材原文为准。
      </p>
      <aside className="call-logic-panel" aria-label="通话逻辑复盘标尺">
        <strong>复盘标尺·通话逻辑</strong>
        <ul>
          {CALL_LOGIC_LAWS.map((law) => (
            <li key={law.key}>
              <b>{law.name}</b>
              {law.law}
            </li>
          ))}
        </ul>
      </aside>
      {managerTurns.length === 0 ? (
        <p>本局没有经理发言。</p>
      ) : (
        <ol className="strategy-path">
          {managerTurns.map((turn) => {
            const entry = entriesByTurn.get(turn.number);
            const customerBefore = (() => {
              const index = result.turns.findIndex((t) => t.number === turn.number);
              for (let i = index - 1; i >= 0; i -= 1) {
                const t = result.turns[i];
                if (t?.speaker === "customer") return t.text;
              }
              return "(未记录)";
            })();
            return (
              <li key={turn.number}>
                <p>对话第 {turn.number} 轮</p>
                <dl className="replay-chain">
                  <div>
                    <dt>客户原话</dt>
                    <dd>“{customerBefore}”</dd>
                  </div>
                  <div>
                    <dt>系统识别信号(候选)</dt>
                    <dd>{turn.recognizedSignal || "未识别"}</dd>
                  </div>
                  <div>
                    <dt>经理当前目的(候选)</dt>
                    <dd>{turn.currentGoal || "未记录"}</dd>
                  </div>
              <div>
                <dt>匹配的策略卡</dt>
                <dd>
                  {entry ? (
                    <>
                      <strong>{entry.cardName}</strong>
                      {entry.matchBasis ? ` — ${entry.matchBasis}` : " — 匹配依据未记录,未确认"}
                    </>
                  ) : (
                    "未确认(本轮话术未对应到任何已发布卡)"
                  )}
                </dd>
              </div>
              {turn.logicHint && (
                <div>
                  <dt>通话逻辑归因(候选)</dt>
                  <dd>{turn.logicHint}</dd>
                </div>
              )}
              {turn.outOfCardFact && (
                <div>
                  <dt>事实核验</dt>
                  <dd className="out-of-card">卡外数字:本轮出现产品卡、客户口述与此前话术之外的数字</dd>
                </div>
              )}
            </dl>
                <blockquote>“{turn.text}”</blockquote>
                {entry?.source && (
                  <p className="source">
                    来源:{entry.source.materialTitle} {entry.source.turnRange}
                  </p>
                )}
                {entry?.source && entry.sourceTurns.length === 0 && (
                  <p className="source">原始片段未能定位(素材可能已删除或轮次区间无法解析)</p>
                )}
                {entry && entry.sourceTurns.length > 0 && (
                  <blockquote className="source-turns">
                    {entry.sourceTurns.map((turn) => (
                      <p key={turn.number}>
                        <span className="who">
                          T{String(turn.number).padStart(2, "0")}{" "}
                          {turn.speaker === "manager" ? "经理" : "客户"}:
                        </span>
                        {turn.text}
                      </p>
                    ))}
                  </blockquote>
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => scrollToTurn(turn.number)}
                  >
                    回放原文
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <h3>完整对话</h3>
      <ol className="result-log">
        {result.turns.map((turn) => (
          <li
            key={turn.number}
            id={`result-turn-${turn.number}`}
            className={`${turn.speaker === "manager" ? "manager" : "customer"}${flashTurn === turn.number ? " flash" : ""}`}
          >
            <span className="who">
              {turn.speaker === "customer" ? "你(生客)" : "理财经理(AI)"}:
            </span>
            {turn.text}
          </li>
        ))}
      </ol>

      <p className="hint">
        {result.promptVersion
          ? `本局经理提示词版本:${result.promptVersion};策略卡内容以发布时为准。`
          : "旧对局记录:未记录提示词版本与用卡匹配依据。"}
      </p>

      <div className="actions">
        <button onClick={onRestart}>再来一局</button>
      </div>
    </section>
  );
}
