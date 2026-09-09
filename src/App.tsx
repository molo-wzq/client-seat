import { useState } from "react";
import type { ConversationResult, Material } from "./domain/types";
import type { ProductApi } from "./product/product-api";
import { BusyHint } from "./ui/BusyHint";
import { WireframePrototype } from "./ui/wireframe-prototype";
import { MaterialStep } from "./ui/MaterialStep";
import { PersonaStep } from "./ui/PersonaStep";
import { CallStep } from "./ui/CallStep";
import { ResultStep } from "./ui/ResultStep";

type StepKey = "material" | "persona" | "call" | "result";

const STEP_LABELS: Array<{ key: StepKey; label: string }> = [
  { key: "material", label: "素材" },
  { key: "persona", label: "画像" },
  { key: "call", label: "对话" },
  { key: "result", label: "结果" },
];

export function App({ api }: { api: ProductApi }) {
  const [step, setStep] = useState<StepKey>("material");
  const [material, setMaterial] = useState<Material | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [result, setResult] = useState<ConversationResult | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  async function quickStart() {
    setQuickBusy(true);
    setQuickError(null);
    try {
      const conversation = await api.quickStart();
      setConversationId(conversation.id);
      setStep("call");
    } catch (e) {
      setQuickError((e as Error).message);
    } finally {
      setQuickBusy(false);
    }
  }

  function restart() {
    setStep("material");
    setMaterial(null);
    setConversationId(null);
    setResult(null);
  }

  const currentStepIndex = STEP_LABELS.findIndex((s) => s.key === step);

  // 低保真线框原型(仅 dev):/?wireframe 开启,?variant=A|B|C 切换,评审用后即弃。
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("wireframe")) {
    return <WireframePrototype />;
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>电话对练</h1>
        <p>把优秀电话素材变成策略,再从客户视角体验一通有策略的首次触达。</p>
      </header>
      <nav className="stepper" aria-label="流程步骤">
        {STEP_LABELS.map((s, i) => (
          <span
            key={s.key}
            className={i === currentStepIndex ? "step-chip current" : "step-chip"}
            aria-current={i === currentStepIndex ? "step" : undefined}
          >
            {i + 1}. {s.label}
          </span>
        ))}
      </nav>
      <div className="actions">
        <button className="ghost" onClick={quickStart} disabled={quickBusy}>
          快速开始一通对话
        </button>
        <span className="hint-inline">跳过素材流程,用内置生客与种子策略直接开练</span>
      </div>
      {quickBusy && <BusyHint text="正在准备对话…" />}
      {quickError && (
        <p role="alert" className="error">
          {quickError}
        </p>
      )}

      {step === "material" && (
        <MaterialStep
          api={api}
          onPublished={(published) => {
            setMaterial(published);
            setStep("persona");
          }}
        />
      )}
      {step === "persona" && material && (
        <PersonaStep
          api={api}
          onStarted={(conversationId) => {
            setConversationId(conversationId);
            setStep("call");
          }}
        />
      )}
      {step === "call" && conversationId && (
        <CallStep
          api={api}
          conversationId={conversationId}
          onFinished={(finishedResult) => {
            setResult(finishedResult);
            setStep("result");
          }}
        />
      )}
      {step === "result" && result && <ResultStep result={result} onRestart={restart} />}
    </main>
  );
}
