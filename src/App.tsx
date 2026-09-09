import { useEffect, useMemo, useState } from "react";
import type { Conversation, ConversationResult, Material, Persona } from "./domain/types";
import type { ProductApi } from "./product/product-api";
import { BusyHint } from "./ui/BusyHint";
import { CardsView, HistoryView, MaterialsView } from "./ui/CatalogViews";
import { LeftRail, type AppView } from "./ui/LeftRail";
import { ResultStep } from "./ui/ResultStep";
import { SetupAct } from "./ui/SetupAct";
import { TableAct } from "./ui/TableAct";
import { WireframePrototype } from "./ui/wireframe-prototype";

export function App({ api }: { api: ProductApi }) {
  const [view, setView] = useState<AppView>("setup");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [result, setResult] = useState<ConversationResult | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  async function refreshCatalog() {
    const [nextPersonas, nextMaterials, nextConversations] = await Promise.all([
      api.listPersonas(),
      api.listMaterials(),
      api.listConversations(),
    ]);
    setPersonas(nextPersonas);
    setMaterials(nextMaterials);
    setConversations(nextConversations);
  }

  async function initialLoad() {
    setCatalogBusy(true);
    setCatalogError(null);
    try {
      await refreshCatalog();
    } catch (e) {
      setCatalogError((e as Error).message);
    } finally {
      setCatalogBusy(false);
    }
  }

  useEffect(() => {
    void initialLoad();
  }, [api]);

  const publishedCards = useMemo(
    () => materials.flatMap((material) => material.cards.filter((card) => card.status === "published")),
    [materials],
  );
  const allCards = useMemo(
    () => materials.flatMap((material) => material.cards),
    [materials],
  );
  const seatedPersona = personas.find((p) => p.id === conversation?.personaId) ?? null;
  // 目录按创建时间倒序;取最近一通进行中的通话,用于离开对局后找回。
  const ongoingCall = conversations.find((c) => c.status === "ongoing") ?? null;

  async function resumeOngoing() {
    if (ongoingCall) await openHistory(ongoingCall);
  }

  async function enterTable(next: Conversation) {
    setConversation(next);
    setResult(null);
    await refreshCatalog().catch(() => undefined);
    setView("table");
  }

  async function quickStart() {
    setQuickBusy(true);
    setError(null);
    try {
      await enterTable(await api.quickStart());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQuickBusy(false);
    }
  }

  async function connect(personaId: string) {
    setConnectBusy(true);
    setError(null);
    try {
      await enterTable(await api.startConversation(personaId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnectBusy(false);
    }
  }

  function restart() {
    setView("setup");
    setConversation(null);
    setResult(null);
  }

  async function openHistory(item: Conversation) {
    setError(null);
    try {
      if (item.status === "ongoing") {
        await enterTable(item);
        return;
      }
      setConversation(item);
      setResult(await api.getResult(item.id));
      setView("postgame");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("wireframe")) {
    return <WireframePrototype />;
  }

  return (
    <div className="app-shell">
      <LeftRail
        view={view}
        materialCount={materials.length}
        cardCount={allCards.length}
        historyCount={conversations.length}
        sessionStatus={conversation?.status ?? null}
        hasOngoing={Boolean(ongoingCall)}
        onNavigate={setView}
        onResumeOngoing={() => void resumeOngoing()}
        onQuickStart={() => void quickStart()}
        quickBusy={quickBusy}
      />
      <main className="app-main">
        {quickBusy && <BusyHint text="正在准备对话…" />}
        {connectBusy && <BusyHint text="正在接通…" />}
        {error && (
          <p role="alert" className="error">
            {error}
            <button type="button" className="error-close" onClick={() => setError(null)} aria-label="关闭错误提示">
              ×
            </button>
          </p>
        )}
        {catalogBusy ? (
          <BusyHint text="正在准备桌面…" />
        ) : catalogError ? (
          <div role="alert" className="error catalog-error">
            <span>目录加载失败:{catalogError}</span>
            <button type="button" onClick={() => void initialLoad()}>
              重试
            </button>
          </div>
        ) : (
          <>
            {view === "setup" && (
              <SetupAct
                api={api}
                personas={personas}
                publishedCards={publishedCards}
                onConnect={(personaId) => void connect(personaId)}
                onCatalogChange={() => void refreshCatalog()}
                connectBusy={connectBusy}
              />
            )}
            {view === "table" && conversation && (
              <TableAct
                api={api}
                conversationId={conversation.id}
                conversation={conversation}
                persona={seatedPersona}
                publishedCards={publishedCards}
                onConversationChange={setConversation}
                onFinished={(finished) => {
                  setResult(finished);
                  setConversation((current) => (current ? { ...current, status: "ended" } : current));
                  setView("postgame");
                  void refreshCatalog();
                }}
              />
            )}
            {view === "postgame" && result && <ResultStep result={result} onRestart={restart} />}
            {view === "materials" && (
              <MaterialsView api={api} materials={materials} onPublished={() => void refreshCatalog()} />
            )}
            {view === "cards" && <CardsView cards={allCards} />}
            {view === "history" && (
              <HistoryView conversations={conversations} personas={personas} onOpen={(item) => void openHistory(item)} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
