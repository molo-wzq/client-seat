import { useState } from "react";
import { SEED_TRANSCRIPT } from "../domain/seed";
import type { CaseAnalysis, Material, MaterialTurn, StrategyCard } from "../domain/types";
import type { ProductApi } from "../product/product-api";
import { AnalysisEditor, CardEditor, TurnsEditor } from "./MaterialEditors";

const STATUS_TEXT: Record<Material["cards"][number]["status"], string> = {
  draft: "草稿",
  published: "已发布",
};

export function MaterialStep({
  api,
  onPublished,
}: {
  api: ProductApi;
  onPublished: (material: Material) => void;
}) {
  const [transcript, setTranscript] = useState(SEED_TRANSCRIPT);
  const [material, setMaterial] = useState<Material | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

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

  async function saveTurns(turns: MaterialTurn[]) {
    if (!material) return;
    await run(async () => {
      setMaterial(await api.updateMaterialDraft(material.id, { turns }));
    });
  }

  async function saveAnalysis(analysis: CaseAnalysis) {
    if (!material) return;
    await run(async () => {
      setMaterial(await api.updateMaterialDraft(material.id, { analysis }));
      setEditingAnalysis(false);
    });
  }

  async function saveCard(card: StrategyCard) {
    if (!material) return;
    await run(async () => {
      setMaterial(await api.updateMaterialDraft(material.id, { cards: [card] }));
      setEditingCardId(null);
    });
  }

  async function publish() {
    if (!material) return;
    await run(async () => {
      onPublished(await api.publishMaterialCards(material.id));
    });
  }

  async function publishCard(cardId: string) {
    if (!material) return;
    await run(async () => {
      setMaterial(await api.publishCards(material.id, [cardId]));
    });
  }

  const draftCount = material?.cards.filter((c) => c.status === "draft").length ?? 0;

  return (
    <section className="step" aria-labelledby="material-title">
      <h2 id="material-title">录音分析</h2>
      <p className="hint">
        粘贴一段优秀电话的转写稿,系统将完成说话人区分与结构化分析,提炼为策略卡。
        识别或提炼有偏差的地方可以直接修改;策略卡确认发布后,才能驱动模拟对话。
      </p>
      <label htmlFor="transcript">电话转写稿</label>
      <textarea
        id="transcript"
        rows={12}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="粘贴电话转写稿,每行一句,如「T01 经理:……」"
      />
      <div className="actions">
        <button onClick={() => run(() => api.analyzeTranscript({ transcript }).then(setMaterial))} disabled={busy || !transcript.trim()}>
          {busy ? "分析中…" : "生成策略卡"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {material && (
        <>
          <TurnsEditor key={material.id} turns={material.turns} onSave={saveTurns} busy={busy} />

          <section aria-label="案例分析">
            <h3>案例分析</h3>
            {editingAnalysis ? (
              <AnalysisEditor
                analysis={material.analysis}
                onSave={saveAnalysis}
                onCancel={() => setEditingAnalysis(false)}
                busy={busy}
              />
            ) : (
              <>
                <AnalysisView analysis={material.analysis} />
                <div className="actions">
                  <button className="ghost" onClick={() => setEditingAnalysis(true)} disabled={busy}>
                    编辑分析
                  </button>
                </div>
              </>
            )}
          </section>

          <div className="cards">
            <h3>策略卡({material.cards.length}张,未发布的以草稿展示)</h3>
            {material.cards.map((card) =>
              editingCardId === card.id ? (
                <CardEditor
                  key={card.id}
                  card={card}
                  onSave={saveCard}
                  onCancel={() => setEditingCardId(null)}
                  busy={busy}
                />
              ) : (
                <article key={card.id} className="card">
                  <header>
                    <strong>{card.name}</strong>
                    <span className={`badge badge-${card.status}`}>{STATUS_TEXT[card.status]}</span>
                  </header>
                  <dl>
                    <div>
                      <dt>触发信号</dt>
                      <dd>{card.triggerSignals.join(";")}</dd>
                    </div>
                    <div>
                      <dt>适用场景</dt>
                      <dd>{card.applicableScenario}</dd>
                    </div>
                    <div>
                      <dt>当前目的</dt>
                      <dd>{card.currentPurpose}</dd>
                    </div>
                    <div>
                      <dt>动作链</dt>
                      <dd>
                        <ol>
                          {card.actionChain.map((action, i) => (
                            <li key={i}>{action}</li>
                          ))}
                        </ol>
                      </dd>
                    </div>
                    <div>
                      <dt>表达原则</dt>
                      <dd>{card.expressionPrinciples.join(";")}</dd>
                    </div>
                    <div>
                      <dt>适用条件</dt>
                      <dd>{card.applicableConditions.join(";")}</dd>
                    </div>
                    <div>
                      <dt>停止条件</dt>
                      <dd>{card.stopConditions.join(";")}</dd>
                    </div>
                    <div>
                      <dt>来源片段</dt>
                      <dd>
                        {card.sourceExcerpt.materialTitle} {card.sourceExcerpt.turnRange}
                      </dd>
                    </div>
                  </dl>
                  {card.status === "draft" && (
                    <div className="actions">
                      <button className="ghost" onClick={() => setEditingCardId(card.id)} disabled={busy}>
                        编辑此卡
                      </button>
                      <button className="ghost" onClick={() => publishCard(card.id)} disabled={busy}>
                        确认发布此卡
                      </button>
                    </div>
                  )}
                </article>
              ),
            )}
            <div className="actions">
              <button onClick={publish} disabled={busy || draftCount === 0}>
                确认并发布全部草稿{draftCount > 0 ? `(${draftCount}张)` : ""}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function AnalysisView({ analysis }: { analysis: CaseAnalysis }) {
  return (
    <dl>
      <div>
        <dt>场景</dt>
        <dd>{analysis.scenario}</dd>
      </div>
      <div>
        <dt>客户状态</dt>
        <dd>{analysis.customerState}</dd>
      </div>
      <div>
        <dt>总体目标</dt>
        <dd>{analysis.overallGoal}</dd>
      </div>
      <div>
        <dt>对话阶段</dt>
        <dd>
          <ol className="stage-view">
            {analysis.stages.map((stage, i) => (
              <li key={i}>
                <strong>{stage.name}</strong>({stage.turnRange})
                <p>目的:{stage.purpose}</p>
                <p>客户信号:{stage.customerSignals}</p>
                <p>推进逻辑:{stage.advanceLogic}</p>
                <p>关键动作:{stage.keyActions.join(" → ")}</p>
                {stage.representativeQuotes.length > 0 && (
                  <p>代表话术:{stage.representativeQuotes.join(" / ")}</p>
                )}
              </li>
            ))}
          </ol>
        </dd>
      </div>
      <div>
        <dt>优秀原因</dt>
        <dd>
          <ul>
            {analysis.strengths.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </dd>
      </div>
      {analysis.weaknesses.length > 0 && (
        <div>
          <dt>做得一般(不建议复用)</dt>
          <dd>
            <ul>
              {analysis.weaknesses.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
      )}
      <div>
        <dt>实际结果</dt>
        <dd>{analysis.actualResult}</dd>
      </div>
      <div>
        <dt>可复用条件</dt>
        <dd>{analysis.reusableConditions.join(";")}</dd>
      </div>
    </dl>
  );
}
