import { useState } from "react";
import { SEED_TRANSCRIPT } from "../domain/seed";
import type { CaseAnalysis, Material, MaterialKind, MaterialTurn, StrategyCard } from "../domain/types";
import { MATERIAL_KINDS } from "../domain/types";
import type { ProductApi } from "../product/product-api";
import { BusyHint } from "./BusyHint";
import { AnalysisEditor, CardEditor, TurnsEditor } from "./MaterialEditors";
import { useBusyTask } from "./use-busy-task";

const STATUS_TEXT: Record<Material["cards"][number]["status"], string> = {
  draft: "草稿",
  published: "已发布",
};

export function MaterialStep({
  api,
  onPublished,
  initialMaterial,
  compact = false,
}: {
  api: ProductApi;
  onPublished?: (material: Material) => void;
  initialMaterial?: Material | null;
  compact?: boolean;
}) {
  const [transcript, setTranscript] = useState(SEED_TRANSCRIPT);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [materialTitle, setMaterialTitle] = useState<string | undefined>();
  const [transcriptionReady, setTranscriptionReady] = useState(false);
  const [kind, setKind] = useState<MaterialKind>(initialMaterial?.kind ?? "顺利沟通");
  const [material, setMaterial] = useState<Material | null>(initialMaterial ?? null);
  const { busy, busyHint, error, run } = useBusyTask("正在保存…");
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

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
      const published = await api.publishMaterialCards(material.id);
      setMaterial(published);
      onPublished?.(published);
    }, "正在发布策略卡…");
  }

  async function saveKind(next: MaterialKind) {
    setKind(next);
    if (!material) return;
    await run(async () => {
      setMaterial(await api.updateMaterialDraft(material.id, { kind: next }));
    });
  }

  async function publishCard(cardId: string) {
    if (!material) return;
    await run(async () => {
      const published = await api.publishCards(material.id, [cardId]);
      setMaterial(published);
      onPublished?.(published);
    }, "正在发布策略卡…");
  }

  const draftCount = material?.cards.filter((c) => c.status === "draft").length ?? 0;

  async function transcribeSelectedAudio() {
    if (!audioFile) return;
    await run(async () => {
      const result = await api.transcribeAudio({
        fileName: audioFile.name,
        mediaType: audioFile.type,
        bytes: new Uint8Array(await audioFile.arrayBuffer()),
      });
      setTranscript(result.transcript);
      setMaterialTitle(audioFile.name.replace(/\.[^.]+$/, ""));
      setTranscriptionReady(true);
    }, "正在转写录音,可能需要几分钟…");
  }

  return (
    <section className="step" aria-labelledby="material-title">
      <h2 id="material-title">{compact ? "自制素材" : "录音分析"}</h2>
      <p className="hint">
        {compact
          ? "粘贴转写稿,分析并发布后新卡下一局生效。完整编辑在左侧「素材库」。"
          : "粘贴一段优秀电话的转写稿,系统将完成说话人区分与结构化分析,提炼为策略卡。识别或提炼有偏差的地方可以直接修改;策略卡确认发布后,才能驱动模拟对话。"}
      </p>
      {!material && (
        <>
          <div className="audio-intake">
            <label htmlFor="audio-file">优秀电话录音</label>
            <input
              id="audio-file"
              type="file"
              accept=".mp3,.m4a,.wav,.webm,.ogg"
              onChange={(event) => {
                setAudioFile(event.target.files?.[0] ?? null);
                setTranscriptionReady(false);
              }}
              disabled={busy}
            />
            <p className="hint">支持 mp3、m4a、wav、webm、ogg,单段不超过 25MB。录音仅用于本次转写,不会保存到素材库。</p>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => void transcribeSelectedAudio()} disabled={busy || !audioFile}>
                转成文字
              </button>
            </div>
          </div>
          {transcriptionReady && <p role="status">转写完成。请先校对下面的文字和说话人,确认后再生成策略卡。</p>}
          <label htmlFor="transcript">电话转写稿</label>
          <textarea
            id="transcript"
            rows={compact ? 6 : 12}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="粘贴电话转写稿,每行一句,如「T01 经理:……」"
          />
          <label htmlFor="material-kind">素材类型</label>
          <select
            id="material-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as MaterialKind)}
            disabled={busy}
          >
            {MATERIAL_KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <div className="actions">
            <button
              onClick={() =>
                run(
                  () => api.analyzeTranscript({ title: materialTitle, transcript, kind }).then(setMaterial),
                  "正在分析转写稿,可能需要 1–2 分钟…",
                )
              }
              disabled={busy || !transcript.trim() || Boolean(audioFile && !transcriptionReady)}
            >
              {busy ? "分析中…" : "生成策略卡"}
            </button>
          </div>
        </>
      )}
      {busy && <BusyHint text={busyHint} />}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {material && compact && (
        <div className="cards">
          <h3>
            {material.title} · {material.kind ?? "未分类"}
          </h3>
          <ul>
            {material.cards.map((card) => (
              <li key={card.id}>
                {card.name}
                <span className={`badge badge-${card.status}`}>{STATUS_TEXT[card.status]}</span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button onClick={publish} disabled={busy || draftCount === 0}>
              确认并发布全部草稿{draftCount > 0 ? `(${draftCount}张)` : ""}
            </button>
          </div>
          {material.cards.some((c) => c.status === "published") && (
            <p className="hint">新卡下一局生效,本通仍用当前已发布卡。完整编辑在左侧「素材库」。</p>
          )}
        </div>
      )}
      {material && !compact && (
        <>
          <label htmlFor="material-kind-edit">素材类型</label>
          <select
            id="material-kind-edit"
            value={material.kind ?? kind}
            onChange={(e) => void saveKind(e.target.value as MaterialKind)}
            disabled={busy}
          >
            {MATERIAL_KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
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
