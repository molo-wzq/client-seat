import { useEffect, useRef, useState } from "react";
import type { ConversationResult, ObservationFocus } from "../domain/types";
import { FEELING_STAMP_META } from "../domain/types";
import type { ProductCore } from "../domain/product-core";
import { CALL_LOGIC_LAWS } from "../domain/call-logic";
import { playSfx } from "./game-feel";
import { FeelingSeal } from "./feeling-stamps";
import { OBSERVATION_FOCI, observationFocus, observationPairs } from "./observation-focus";
import { ReplayComparison } from "./ReplayComparison";
import { ProductFacts } from "./ProductFacts";
import { SEED_PRODUCT_CARD } from "../domain/seed";

export function ResultStep({
  result,
  api,
  onRestart,
  onReplay,
  replayBusy = false,
  onBranch,
}: {
  result: ConversationResult;
  api?: ProductCore;
  onRestart: () => void;
  onReplay?: (focus: ObservationFocus) => void;
  replayBusy?: boolean;
  onBranch?: (customerTurnNumber: number, text: string) => Promise<void>;
}) {
  // 回放原文时在完整对话里闪烁定位目标轮次;同轮连续点击也要能重触发,
  // 所以先清空再在下一帧置回,动画由 CSS 的 li.flash 承担。
  const [flashTurn, setFlashTurn] = useState<number | null>(null);
  const [replayFocus, setReplayFocus] = useState<ObservationFocus>(result.observationFocus ?? "free");
  const observation = observationFocus(result.observationFocus);
  const pairs = observationPairs(result);
  const flashTimer = useRef<number | undefined>(undefined);
  const [branchTurn, setBranchTurn] = useState<number | null>(null);
  const [branchText, setBranchText] = useState('');
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [observations, setObservations] = useState(result.observations ?? []);
  const [markingTurn, setMarkingTurn] = useState<number | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function mark(turnNumber: number) {
    if (!api || typeof api.saveObservation !== 'function' || markingTurn !== null || replayBusy) return;
    const previous = observations.find((note) => note.managerTurnNumber === turnNumber);
    setMarkingTurn(turnNumber); setNoteError(null);
    try {
      const next = await api.saveObservation(result.conversationId, { managerTurnNumber: turnNumber, evidence: '', nextExperiment: '', revealed: true, ...previous, marked: !previous?.marked });
      setObservations(next.observations ?? []);
    } catch (error) { setNoteError((error as Error).message); }
    finally { setMarkingTurn(null); }
  }

  async function startBranch() {
    if (!onBranch || branchTurn === null || !branchText.trim() || branchBusy || replayBusy) return;
    setBranchBusy(true); setBranchError(null);
    try { await onBranch(branchTurn, branchText); }
    catch (error) { setBranchError((error as Error).message); }
    finally { setBranchBusy(false); }
  }

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // 盖章音效对齐 stamp-slam 的砸落帧(动画延迟 220ms、约 55% 处着桌)。
  useEffect(() => {
    const t = window.setTimeout(() => playSfx("stamp"), 450);
    return () => window.clearTimeout(t);
  }, []);

  function scrollToTurn(turnNumber: number) {
    const transcript = document.getElementById("result-transcript") as HTMLDetailsElement | null;
    if (transcript) transcript.open = true;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target = document.getElementById(`result-turn-${turnNumber}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    window.clearTimeout(flashTimer.current);
    setFlashTurn(null);
    requestAnimationFrame(() => setFlashTurn(turnNumber));
    flashTimer.current = window.setTimeout(() => setFlashTurn(null), 1800);
  }

  function inspectTurn(turnNumber: number) {
    const target = document.getElementById(`review-turn-${turnNumber}`) as HTMLDetailsElement | null;
    if (!target) return;
    target.open = true;
    target.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  // 逐经理轮的复盘链:客户本轮原话 → 系统识别信号/目的 → 策略卡 → 实际回应 → 来源。
  // 未匹配到卡的经理轮同样进列表,如实显示"未确认",不为复盘完整硬配一张卡。
  const managerTurns = result.turns.filter((t) => t.speaker === "manager");
  const entriesByTurn = new Map(result.strategyPath.map((e) => [e.turnNumber, e]));
  const feelingByTurn = new Map(observations.map((note) => [note.managerTurnNumber, note.feeling]));
  const stampedCount = observations.filter((note) => note.feeling).length;
  const matchedCount = managerTurns.filter((t) => entriesByTurn.has(t.number)).length;
  const flaggedCount = managerTurns.filter((t) => t.outOfCardFact).length;
  const focusTurn = managerTurns.find((t) => t.outOfCardFact)
    ?? managerTurns.find((t) => t.factCheckNotes?.length)
    ?? managerTurns.find((t) => !entriesByTurn.has(t.number) || !entriesByTurn.get(t.number)?.matchBasis)
    ?? managerTurns.at(-1);
  const focusText = focusTurn?.outOfCardFact
    ? "这一轮标记了卡外数字，先对照本局参数与客户原话，核对数字从哪里来。标记本身不等于已确认错误。"
    : focusTurn?.factCheckNotes?.length
      ? "这一轮有事实核对候选，先展开参数，看经理是否扩大了条件。候选不是已确认错误，匹配到卡也不表示事实正确。"
    : focusTurn && (!entriesByTurn.has(focusTurn.number) || !entriesByTurn.get(focusTurn.number)?.matchBasis)
      ? "这一轮用卡或匹配依据未确认，先看经理实际说了什么，再与卡内动作对照。"
      : "先看最后一轮：经理回应了客户哪句话？下一步是否说清？再向前追溯打法。";

  return (
    <section className="step result-act" aria-labelledby="result-title">
      <span className="act-kicker">第三幕 / 对局复盘</span>
      <div className="result-heading">
        <div>
          <h2 id="result-title">这通电话是怎样推进的</h2>
          <p className="hint">只解释 AI 的打法,不评价你的客户表现。</p>
        </div>
        <span className="result-stamp" aria-hidden="true">本局<br />通话结束</span>
      </div>

      <aside className="review-focus" aria-label="本局复盘起点">
        <h3>先看这一处</h3>
        <p className="review-counts">{managerTurns.length} 轮经理回应 · {matchedCount} 轮有策略卡记录 · {flaggedCount} 轮标记卡外数字</p>
        {focusTurn ? <>
          <p>{focusText}</p>
          <button type="button" className="ghost" onClick={() => inspectTurn(focusTurn.number)}>
            核对 T{String(focusTurn.number).padStart(2, "0")}
          </button>
        </> : <p>你在经理回应前结束了通话。可以重试这位客户，说声「喂」后观察开场。</p>}
        <p className="hint">下一局只换一个回应，比较经理怎样接话；这些记录数量不代表打法质量。</p>
        {onReplay && <label className="replay-focus-picker">下局观察点
          <select value={replayFocus} onChange={(e) => setReplayFocus(e.target.value as ObservationFocus)} disabled={replayBusy}>
            {OBSERVATION_FOCI.map((focus) => <option key={focus.id} value={focus.id}>{focus.label}</option>)}
          </select>
        </label>}
        <div className="actions">
          {onReplay && <button type="button" onClick={() => onReplay(replayFocus)} disabled={replayBusy}>同一客户再试</button>}
          <button type="button" className="ghost" onClick={onRestart} disabled={replayBusy}>再来一局</button>
        </div>
      </aside>

      {managerTurns.length > 0 && (
        <aside className="empathy-timeline" aria-label="换位体感走势">
          <h3>你的体感 × 经理的出牌</h3>
          {stampedCount > 0 ? (
            <>
              <p className="hint">
                印章是你听电话时随手盖下的第一直觉,下方一格是经理同一轮用的策略卡。点一轮下钻对照:哪句话让你抵触,哪句让你想听下去。体感是你自己的记录,不是对经理的评分。
              </p>
              <ol className="empathy-strip">
                {managerTurns.map((turn) => {
                  const feeling = feelingByTurn.get(turn.number);
                  const meta = feeling ? FEELING_STAMP_META[feeling] : undefined;
                  const entry = entriesByTurn.get(turn.number);
                  return (
                    <li key={turn.number}>
                      <button
                        type="button"
                        className={`empathy-node${meta ? ` tone-${meta.tone}` : ""}`}
                        onClick={() => inspectTurn(turn.number)}
                        title={meta ? `你盖的「${meta.label}」 · 经理用卡:${entry?.cardName ?? "未确认"}` : `未盖体感戳 · 经理用卡:${entry?.cardName ?? "未确认"}`}
                      >
                        <span className="node-up" aria-hidden="true">
                          {meta && meta.tone === "positive" ? <i className="node-seal" data-feeling={feeling}>{meta.seal}</i> : null}
                        </span>
                        <span className="node-mid" aria-hidden="true">{!meta ? <i className="node-dot" /> : null}</span>
                        <span className="node-down">
                          {meta && meta.tone === "negative" ? <i className="node-seal" data-feeling={feeling} aria-hidden="true">{meta.seal}</i> : null}
                          <span className="node-card">{entry?.cardName ?? "用卡未确认"}</span>
                          <span className="node-label">T{String(turn.number).padStart(2, "0")}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="empathy-legend hint">
                <span><i className="legend-dot tone-positive" aria-hidden="true" />上抬 = 防备松动(趣 / 暖)</span>
                <span><i className="legend-dot tone-negative" aria-hidden="true" />下压 = 抵触上升(油 / 烦)</span>
              </p>
            </>
          ) : (
            <p className="hint">
              这局没有体感记录。回到对局时,听完每句经理话术随手盖一枚「太油了 / 听不进 / 有点意思 / 被打动」,复盘就能看到这条走势和他每轮的出牌对在一起。
            </p>
          )}
        </aside>
      )}

      <details className="review-overview">
      <summary>通话概况 · {managerTurns.length} 轮经理回应</summary>
      <dl className="result-summary">
        <div>
          <dt>开局目标</dt>
          <dd>{result.mainGoal}</dd>
        </div>
        <div><dt>最后动作（候选）</dt><dd>{result.lastAction ?? '旧记录未单独保存'}</dd></div>
        <div>
          <dt>沟通结果</dt>
          <dd>{result.outcome}</dd>
        </div>
        <div>
          <dt>结束原因</dt>
          <dd>{result.endReason}</dd>
        </div>
      </dl>
      </details>

      <aside className="observation-review" aria-label="围绕观察点核对">
        <h3>{observation.question}</h3>
        <p>{observation.check}</p>
        <details className="review-product-facts">
          <summary>核对参数 · 活动资格与产品取用</summary>
          <p className="hint">{result.productFacts ? "以下参数按本局开局时保存。" : "旧记录未保存当时产品参数，以下是当前默认参数，不能保证与当时相同。"}</p>
          <ProductFacts product={result.productFacts ?? SEED_PRODUCT_CARD} />
        </details>
        {pairs.length ? <>
          <p className="hint">按客户原话定位到 {pairs.length} 处核对入口，先看前 {Math.min(3, pairs.length)} 处；是否接住信号仍需对照实际回应。</p>
          <ul>{pairs.slice(0, 3).map(({ customer, manager }) => <li key={manager.number}>
            <p>客户：{customer.text}</p>
            <blockquote>{manager.text}</blockquote>
            <button type="button" className="ghost" onClick={() => inspectTurn(manager.number)}>核对本轮打法 T{String(manager.number).padStart(2, "0")}</button>
          </li>)}</ul>
        </> : <p>本局尚未定位到与这个观察点相关的客户原话；可检查完整复盘，或下局表达一项符合画像的顾虑／追问。不据此判定经理做得好或不好。</p>}
      </aside>

      {noteError && <p role="alert">{noteError}</p>}
      {observations.some((note) => note.judgement || note.evidence || note.marked || note.nextExperiment || note.feeling) && <aside className="review-focus" aria-label="我的发现与下一次试探">
        <h3>我的发现与下一次试探</h3>
        {observations.filter((note) => note.judgement || note.evidence || note.marked || note.nextExperiment || note.feeling).map((note) => <section key={note.managerTurnNumber}>
          <strong>T{note.managerTurnNumber} · {note.marked ? '复盘重点' : '自己的观察'}</strong>
          {note.feeling && <p className="feeling-line">你的体感:<FeelingSeal feeling={note.feeling} label /></p>}
          <p>判断：{note.judgement === 'addressed' ? '回应到了' : note.judgement === 'missed' ? '可能遗漏' : note.judgement === 'uncertain' ? '信息不足' : '暂未判断'}</p>
          <p>依据：{note.evidence || '还未补充'}</p>
          {note.nextExperiment && <p>下次只改变：{note.nextExperiment}</p>}
          <button type="button" className="ghost" onClick={() => inspectTurn(note.managerTurnNumber)}>用原话核对这条发现</button>
        </section>)}
        <p className="hint">记录了发现不代表已经验证。可以在关键轮分支里检验，也可换客户看同一个判断是否成立。</p>
      </aside>}

      {api && result.replayOfId && !result.branch && <ReplayComparison api={api} result={result} />}

      {result.branch && <aside className="review-focus" aria-label="关键轮分支对照">
        <h3>同一前情，只换这一句</h3>
        <p>客户原句：{result.branch.originalCustomerText}</p>
        <blockquote>原经理回应：{result.branch.originalManagerTurn.text}</blockquote>
        <p>新客户回应：{result.turns.find((turn) => turn.number === result.branch!.customerTurnNumber)?.text}</p>
        <blockquote>新经理回应：{result.turns.find((turn) => turn.number === result.branch!.customerTurnNumber + 1)?.text}</blockquote>
        <p className="hint">前情、画像、参数与策略候选已按原局保存。生成仍可能波动；规则版本不同时不能只归因于客户话术。</p>
        <p className="hint">原回应规则：{result.branch.originalManagerTurn.promptVersion ?? '未记录'}；新回应规则：{result.turns.find((turn) => turn.number === result.branch!.customerTurnNumber + 1)?.promptVersion ?? '未记录'}</p>
      </aside>}
      {result.revisions?.length ? <details className="review-overview">
        <summary>重新生成的原回复 · {result.revisions.length} 个版本</summary>
        {result.revisions.map((revision, index) => <section key={index}>
          <h4>T{revision.turn.number} · 第{index + 1}个保留版本</h4>
          <blockquote>{revision.turn.text}</blockquote>
          <p className="hint">当时的目的（候选）：{revision.turn.currentGoal ?? '未记录'}；规则：{revision.turn.promptVersion ?? '未记录'}</p>
        </section>)}
      </details> : null}

      {branchTurn !== null && <aside className="review-focus" aria-label="改写关键轮">
        <h3>改写客户 T{branchTurn} 的一句回应</h3>
        <p>原局与这句之前的对话会保留；新回应将在独立分支里继续。</p>
        <label htmlFor="branch-reply">只改变的一项条件或表达</label>
        <textarea id="branch-reply" value={branchText} maxLength={4000} onChange={(event) => setBranchText(event.target.value)} disabled={branchBusy || replayBusy} />
        {branchError && <p role="alert">{branchError}</p>}
        <div className="actions">
          <button type="button" disabled={branchBusy || replayBusy || !branchText.trim()} onClick={() => void startBranch()}>保留前情，试这一句</button>
          <button type="button" className="ghost" disabled={branchBusy || replayBusy} onClick={() => setBranchTurn(null)}>取消改写</button>
        </div>
      </aside>}



      <h3>逐轮打法复盘</h3>
      <p className="hint">展开一轮，沿「客户原话 → 识别信号 → 策略卡 → 经理回应 → 素材来源」核对。</p>
      <p className="hint">
        信号、目的、用卡与事实核对提示为话术生成后的候选,以实际话术、参数与素材原文为准。未记录疑点不代表通过事实核验。
      </p>
      <aside className="call-logic-panel" aria-label="通话逻辑复盘标尺">
        <strong>复盘标尺</strong>
        {/* 四条规律名做一行锚点,整句进悬停;逐轮归因已在下方链路里。 */}
        <ul>
          {CALL_LOGIC_LAWS.map((law) => (
            <li key={law.key} title={law.law}>
              {law.name}
            </li>
          ))}
        </ul>
      </aside>
      {managerTurns.length === 0 ? (
        <p>本局没有经理发言。</p>
      ) : (
        <ol className="strategy-path">
          {managerTurns.map((turn, managerIndex) => {
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
                <details className="review-turn-details" id={`review-turn-${turn.number}`}>
                <summary>经理第 {managerIndex + 1} 轮 · T{String(turn.number).padStart(2, "0")}
                  {feelingByTurn.get(turn.number) && (
                    <span className="summary-feeling" title={`你盖的体感戳:${FEELING_STAMP_META[feelingByTurn.get(turn.number)!].label}`}>
                      <FeelingSeal feeling={feelingByTurn.get(turn.number)!} />
                    </span>
                  )}
                  <small>{entry?.cardName ?? "用卡未确认"}{turn.outOfCardFact || turn.factCheckNotes?.length ? " · 有事实核对提示" : ""}</small></summary>
                <p className="hint">本轮生成规则版本：{turn.promptVersion ?? "旧记录未独立保存"}</p>
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
                  <dd className="out-of-card">卡外数字:本轮出现产品卡与客户口述之外的数字；经理先前说过也需要依据</dd>
                </div>
              )}
              {turn.factCheckNotes?.length ? <div>
                <dt>事实核对（候选）</dt>
                <dd><ul>{turn.factCheckNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></dd>
              </div> : null}
            </dl>
                <blockquote>“{turn.text}”</blockquote>
                {entry?.source && (
                  <p className="source">
                    来源:{entry.source.materialTitle} {entry.source.turnRange}
                  </p>
                )}
                {entry?.source && <p className="source">{entry.evidenceOrigin === "turn-snapshot" ? "来源片段已按本轮保存。" : "旧记录未保存当时来源片段，以下按当前素材库回溯，可能与当时不同。"}</p>}
                {entry?.source && entry.sourceTurns.length === 0 && (
                  <p className="source">原始片段未能可靠定位(来源不存在、旧标题重名或轮次区间无法解析)</p>
                )}
                {entry && entry.sourceTurns.length > 0 && (
                  <details className="source-evidence">
                    <summary>查看来源片段 · {entry.sourceTurns.length} 句</summary>
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
                  </details>
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => scrollToTurn(turn.number)}
                  >
                    回放原文
                  </button>
                  {onBranch && result.resources && <button type="button" className="ghost" disabled={branchBusy || replayBusy} onClick={() => {
                    const index = result.turns.findIndex((item) => item.number === turn.number);
                    const customer = result.turns[index - 1];
                    if (customer?.speaker !== 'customer') return;
                    setBranchTurn(customer.number); setBranchText(customer.text); setBranchError(null);
                  }}>只换这句，保留前情</button>}
                  {api && typeof api.saveObservation === 'function' && <button type="button" className="ghost" disabled={markingTurn !== null || replayBusy} onClick={() => void mark(turn.number)}>{observations.some((note) => note.managerTurnNumber === turn.number && note.marked) ? '取消复盘重点' : '标为复盘重点'}</button>}
                </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      <details className="review-transcript" id="result-transcript">
      <summary>完整对话 · {result.turns.length} 句</summary>
      <ol className="result-log">
        {result.turns.map((turn) => (
          <li
            key={turn.number}
            id={`result-turn-${turn.number}`}
            tabIndex={-1}
            className={`${turn.speaker === "manager" ? "manager" : "customer"}${flashTurn === turn.number ? " flash" : ""}`}
          >
            <span className="who">
              {turn.speaker === "customer" ? "你(生客)" : "理财经理(AI)"}:
            </span>
            {turn.text}
          </li>
        ))}
      </ol>
      </details>

      <p className="hint">
        {result.promptVersion
          ? `本局开局提示词版本:${result.promptVersion};各轮生成规则与来源证据以保存记录为准。`
          : "旧对局记录:未记录提示词版本与用卡匹配依据。"}
      </p>

    </section>
  );
}
