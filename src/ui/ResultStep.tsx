import type { ConversationResult } from "../domain/types";

export function ResultStep({
  result,
  onRestart,
}: {
  result: ConversationResult;
  onRestart: () => void;
}) {
  return (
    <section className="step" aria-labelledby="result-title">
      <h2 id="result-title">这通电话是怎样推进的</h2>
      <p className="hint">只解释 AI 的打法,不评价你的客户表现。</p>

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

      <h3>策略路径(实际使用了哪些已发布策略卡)</h3>
      {result.strategyPath.length === 0 ? (
        <p>本轮对话未引用任何策略卡。</p>
      ) : (
        <ol className="strategy-path">
          {result.strategyPath.map((entry) => (
            <li key={`${entry.turnNumber}-${entry.cardId}`}>
              <p>
                对话第 {entry.turnNumber} 轮 · <strong>{entry.cardName}</strong>
              </p>
              <blockquote>“{entry.keyExpression}”</blockquote>
              {entry.source && (
                <p className="source">
                  来源:{entry.source.materialTitle} {entry.source.turnRange}
                </p>
              )}
              {entry.source && entry.sourceTurns.length === 0 && (
                <p className="source">原始片段未能定位(素材可能已删除或轮次区间无法解析)</p>
              )}
              {entry.sourceTurns.length > 0 && (
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
            </li>
          ))}
        </ol>
      )}

      <h3>完整对话</h3>
      <ol className="result-log">
        {result.turns.map((turn) => (
          <li key={turn.number}>
            <span className="who">
              {turn.speaker === "customer" ? "你(生客)" : "理财经理(AI)"}:
            </span>
            {turn.text}
          </li>
        ))}
      </ol>

      <div className="actions">
        <button onClick={onRestart}>重新开始一轮</button>
      </div>
    </section>
  );
}
