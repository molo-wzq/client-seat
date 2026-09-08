import { useState } from "react";
import { SEED_TRANSCRIPT } from "../domain/seed";
import type { Material } from "../domain/types";
import type { ProductApi } from "../product/product-api";

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

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setMaterial(await api.analyzeTranscript({ transcript }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!material) return;
    setBusy(true);
    setError(null);
    try {
      onPublished(await api.publishMaterialCards(material.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="step" aria-labelledby="material-title">
      <h2 id="material-title">录音分析</h2>
      <p className="hint">
        粘贴一段优秀电话的转写稿,系统将完成说话人区分与结构化分析,提炼为策略卡。
        策略卡确认发布后,才能驱动模拟对话。
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
        <button onClick={generate} disabled={busy || !transcript.trim()}>
          {busy ? "分析中…" : "生成策略卡"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {material && (
        <div className="cards">
          <h3>生成的策略卡({material.cards.length}张,当前为草稿)</h3>
          {material.cards.map((card) => (
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
            </article>
          ))}
          <div className="actions">
            <button onClick={publish} disabled={busy}>
              确认并发布
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
