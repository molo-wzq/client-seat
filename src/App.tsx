import { useState } from "react";
import type { ConversationResult, Material } from "./domain/types";
import type { ProductApi } from "./product/product-api";
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

  function restart() {
    setStep("material");
    setMaterial(null);
    setConversationId(null);
    setResult(null);
  }

  const currentStepIndex = STEP_LABELS.findIndex((s) => s.key === step);

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
