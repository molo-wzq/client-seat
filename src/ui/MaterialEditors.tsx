import { useState } from "react";
import type { CaseAnalysis, MaterialTurn, StrategyCard } from "../domain/types";

/** 一行一项的字符串列表编辑:回车分隔,空行忽略。 */
export function LinesEditor({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string[];
  onChange: (lines: string[]) => void;
  rows?: number;
}) {
  return (
    <>
      <label>
        {label}
        <textarea
          rows={rows}
          value={value.join("\n")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
            )
          }
        />
      </label>
    </>
  );
}

/** 说话人纠正:逐轮切换经理/客户,保存后进入素材。 */
export function TurnsEditor({
  turns,
  onSave,
  busy,
}: {
  turns: MaterialTurn[];
  onSave: (turns: MaterialTurn[]) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<MaterialTurn[]>(turns);
  const [dirty, setDirty] = useState(false);

  function flip(index: number) {
    setDraft((current) =>
      current.map((turn, i) =>
        i === index
          ? { ...turn, speaker: turn.speaker === "manager" ? "customer" : "manager" }
          : turn,
      ),
    );
    setDirty(true);
  }

  return (
    <section aria-label="转写轮次">
      <h3>转写轮次(说话人识别结果)</h3>
      <p className="hint">识别错误时点击角色按钮纠正;序号保持不变,作为策略来源的轮次坐标。</p>
      <ol className="material-turns">
        {draft.map((turn, index) => (
          <li key={turn.number} className={`material-turn is-${turn.speaker}`}>
            <span className="turn-no">T{String(turn.number).padStart(2, "0")}</span>
            <button
              type="button"
              className="ghost"
              onClick={() => flip(index)}
              disabled={busy}
              aria-label={`第${turn.number}轮切换说话人`}
            >
              {turn.speaker === "manager" ? "经理" : "客户"}
            </button>
            <span className="turn-text">{turn.text}</span>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button
          type="button"
          onClick={async () => {
            await onSave(draft);
            setDirty(false);
          }}
          disabled={busy || !dirty}
        >
          保存说话人修正
        </button>
        {dirty && <span className="save-note">有未保存的角色修正</span>}
      </div>
    </section>
  );
}

/** 案例分析编辑表单:结构对应 l1/case-analysis-template.md。 */
export function AnalysisEditor({
  analysis,
  onSave,
  onCancel,
  busy,
}: {
  analysis: CaseAnalysis;
  onSave: (analysis: CaseAnalysis) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<CaseAnalysis>(analysis);

  function updateStage(index: number, patch: Partial<CaseAnalysis["stages"][number]>) {
    setDraft((current) => ({
      ...current,
      stages: current.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)),
    }));
  }

  return (
    <div className="editor">
      <label>
        场景
        <textarea rows={3} value={draft.scenario} onChange={(e) => setDraft({ ...draft, scenario: e.target.value })} />
      </label>
      <label>
        客户状态
        <textarea
          rows={3}
          value={draft.customerState}
          onChange={(e) => setDraft({ ...draft, customerState: e.target.value })}
        />
      </label>
      <label>
        总体目标
        <textarea
          rows={2}
          value={draft.overallGoal}
          onChange={(e) => setDraft({ ...draft, overallGoal: e.target.value })}
        />
      </label>
      <label>
        实际结果
        <textarea
          rows={2}
          value={draft.actualResult}
          onChange={(e) => setDraft({ ...draft, actualResult: e.target.value })}
        />
      </label>
      <LinesEditor label="优秀原因(一行一条)" value={draft.strengths} onChange={(strengths) => setDraft({ ...draft, strengths })} />
      <LinesEditor
        label="做得一般、不建议复用(一行一条,可留空)"
        value={draft.weaknesses}
        onChange={(weaknesses) => setDraft({ ...draft, weaknesses })}
        rows={2}
      />
      <LinesEditor
        label="可复用条件(一行一条)"
        value={draft.reusableConditions}
        onChange={(reusableConditions) => setDraft({ ...draft, reusableConditions })}
      />
      {draft.stages.map((stage, index) => (
        <fieldset key={index} className="stage-editor">
          <legend>阶段 {index + 1}</legend>
          <label>
            阶段名
            <input value={stage.name} onChange={(e) => updateStage(index, { name: e.target.value })} />
          </label>
          <label>
            轮次区间
            <input value={stage.turnRange} onChange={(e) => updateStage(index, { turnRange: e.target.value })} />
          </label>
          <label>
            阶段目的
            <textarea rows={2} value={stage.purpose} onChange={(e) => updateStage(index, { purpose: e.target.value })} />
          </label>
          <label>
            客户信号
            <textarea
              rows={2}
              value={stage.customerSignals}
              onChange={(e) => updateStage(index, { customerSignals: e.target.value })}
            />
          </label>
          <label>
            推进逻辑
            <textarea
              rows={2}
              value={stage.advanceLogic}
              onChange={(e) => updateStage(index, { advanceLogic: e.target.value })}
            />
          </label>
          <LinesEditor
            label="关键动作(一行一条)"
            value={stage.keyActions}
            onChange={(keyActions) => updateStage(index, { keyActions })}
          />
          <LinesEditor
            label="代表话术(一行一条,标轮次)"
            value={stage.representativeQuotes}
            onChange={(representativeQuotes) => updateStage(index, { representativeQuotes })}
          />
        </fieldset>
      ))}
      <div className="actions">
        <button type="button" onClick={() => onSave(draft)} disabled={busy}>
          保存分析
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 策略卡编辑表单(仅草稿卡);来源片段只读,保证追溯关系稳定。 */
export function CardEditor({
  card,
  onSave,
  onCancel,
  busy,
}: {
  card: StrategyCard;
  onSave: (card: StrategyCard) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<StrategyCard>(card);

  return (
    <div className="editor">
      <label>
        卡名
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <LinesEditor
        label="触发信号(一行一条)"
        value={draft.triggerSignals}
        onChange={(triggerSignals) => setDraft({ ...draft, triggerSignals })}
      />
      <label>
        适用场景
        <textarea
          rows={2}
          value={draft.applicableScenario}
          onChange={(e) => setDraft({ ...draft, applicableScenario: e.target.value })}
        />
      </label>
      <label>
        当前目的
        <textarea
          rows={2}
          value={draft.currentPurpose}
          onChange={(e) => setDraft({ ...draft, currentPurpose: e.target.value })}
        />
      </label>
      <LinesEditor
        label="动作链(一行一条,按顺序)"
        value={draft.actionChain}
        onChange={(actionChain) => setDraft({ ...draft, actionChain })}
      />
      <LinesEditor
        label="表达原则(一行一条)"
        value={draft.expressionPrinciples}
        onChange={(expressionPrinciples) => setDraft({ ...draft, expressionPrinciples })}
      />
      <LinesEditor
        label="参考话术(一行一条)"
        value={draft.referenceScripts}
        onChange={(referenceScripts) => setDraft({ ...draft, referenceScripts })}
      />
      <LinesEditor
        label="适用条件(一行一条)"
        value={draft.applicableConditions}
        onChange={(applicableConditions) => setDraft({ ...draft, applicableConditions })}
      />
      <LinesEditor
        label="停止条件(一行一条)"
        value={draft.stopConditions}
        onChange={(stopConditions) => setDraft({ ...draft, stopConditions })}
      />
      <p className="source">
        来源片段(不可改):{draft.sourceExcerpt.materialTitle} {draft.sourceExcerpt.turnRange}
      </p>
      <div className="actions">
        <button type="button" onClick={() => onSave(draft)} disabled={busy}>
          保存该卡
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  );
}
