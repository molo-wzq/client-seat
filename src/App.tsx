import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, ConversationResult, ConversationStartOptions, Material, Persona } from "./domain/types";
import type { ProductCore } from "./domain/product-core";
import { BusyHint } from "./ui/BusyHint";
import { CardsView, HistoryView, MaterialsView } from "./ui/CatalogViews";
import { LeftRail, type AppView } from "./ui/LeftRail";
import { ResultStep } from "./ui/ResultStep";
import { SetupAct } from "./ui/SetupAct";
import { TableAct } from "./ui/TableAct";
import { WireframePrototype } from "./ui/wireframe-prototype";
import { playSfx } from "./ui/game-feel";

export function App({ api }: { api: ProductCore }) {
  const [view, setView] = useState<AppView>("setup");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [result, setResult] = useState<ConversationResult | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollIntoView?.({ block: "start" });
    if (!catalogBusy) mainRef.current?.focus({ preventScroll: true });
  }, [view, conversation?.id, catalogBusy]);

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
  // 快速开始/接通/找回进行中通话都会进入对局,共用一个互斥位:
  // refreshCatalog 需数百毫秒,期间交错点击会让两次 enterTable 按完成顺序互相覆盖。
  const entryBusy = quickBusy || connectBusy || historyBusy;
  const enteringRef = useRef(false);
  const entryRequestRef = useRef(false);

  async function resumeOngoing() {
    if (ongoingCall && !entryBusy) await openHistory(ongoingCall);
  }

  async function enterTable(next: Conversation) {
    if (enteringRef.current) return;
    enteringRef.current = true;
    try {
      setConversation(next);
      setResult(null);
      // 先切到对局幕:接通过场(振铃入场)立即上场,几百毫秒的目录刷新退到后台补。
      // 交错点击仍被 enteringRef 互斥位挡住,目录在互斥窗口内完成刷新,不会互相覆盖。
      setView("table");
      await refreshCatalog().catch(() => undefined);
    } finally {
      enteringRef.current = false;
    }
  }

  async function quickStart() {
    if (entryRequestRef.current) return;
    entryRequestRef.current = true;
    setQuickBusy(true);
    setError(null);
    playSfx("dial");
    try {
      await enterTable(await api.quickStart());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQuickBusy(false);
      entryRequestRef.current = false;
    }
  }

  async function connect(personaId: string, options?: ConversationStartOptions) {
    if (entryRequestRef.current) return;
    entryRequestRef.current = true;
    setConnectBusy(true);
    setError(null);
    playSfx("dial");
    try {
      await enterTable(await api.startConversation(personaId, options));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnectBusy(false);
      entryRequestRef.current = false;
    }
  }

  async function branch(turnNumber: number, text: string) {
    if (!result || entryRequestRef.current) return;
    entryRequestRef.current = true;
    setConnectBusy(true);
    try { await enterTable(await api.branchConversation(result.conversationId, turnNumber, text)); }
    finally { setConnectBusy(false); entryRequestRef.current = false; }
  }

  function restart() {
    setView("setup");
    setConversation(null);
    setResult(null);
  }

  async function openHistory(item: Conversation) {
    if (entryRequestRef.current) return;
    entryRequestRef.current = true;
    setHistoryBusy(true);
    setError(null);
    try {
      const fresh = await api.getConversation(item.id);
      if (fresh.status === "ongoing") {
        await enterTable(fresh);
        return;
      }
      const nextResult = await api.getResult(fresh.id);
      setConversation(fresh);
      setResult(nextResult);
      setView("postgame");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryBusy(false);
      entryRequestRef.current = false;
    }
  }

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("wireframe")) {
    return <WireframePrototype />;
  }

  return (
    <div className="app-shell" data-view={view}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <LeftRail
        view={view}
        materialCount={materials.length}
        cardCount={publishedCards.length}
        historyCount={conversations.length}
        sessionStatus={conversation?.status ?? null}
        hasOngoing={Boolean(ongoingCall)}
        onNavigate={(nextView) => {
          if (nextView === "postgame" && !result && conversation?.status === "ended") {
            void openHistory(conversation);
          } else setView(nextView);
        }}
        onResumeOngoing={() => void resumeOngoing()}
        onQuickStart={() => void quickStart()}
        quickBusy={entryBusy}
      />
      <main className="app-main" id="main-content" tabIndex={-1} ref={mainRef}>
        {quickBusy && <BusyHint text="正在准备对话…" />}
        {connectBusy && <BusyHint text="正在接通…" />}
        {historyBusy && <BusyHint text="正在加载通话…" />}
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
                onConnect={(personaId, focus) => void connect(personaId, { observationFocus: focus })}
                onCatalogChange={() => void refreshCatalog()}
                connectBusy={entryBusy}
              />
            )}
            {conversation && (!result || view === "table") && (
              <div className="session-view" hidden={view !== "table"}>
              <TableAct
                key={conversation.id}
                api={api}
                conversationId={conversation.id}
                conversation={conversation}
                persona={seatedPersona}
                publishedCards={publishedCards}
                onConversationChange={(next) => {
                  const accept = (current: Conversation) => next.revision === undefined || current.revision === undefined || next.revision >= current.revision;
                  setConversation((current) => current?.id === next.id && accept(current) ? next : current);
                  setConversations((current) => current.map((item) => item.id === next.id && accept(item) ? next : item));
                }}
                onFinished={(finished) => {
                  setResult(finished);
                  setConversation((current) => (current ? { ...current, status: "ended" } : current));
                  setView((current) => current === "table" ? "postgame" : current);
                  void refreshCatalog().catch(() => undefined);
                }}
              />
              </div>
            )}
            {view === "postgame" && result && <ResultStep
              key={result.conversationId}
              result={result}
              api={api}
              onRestart={restart}
              onReplay={seatedPersona ? (focus) => void connect(seatedPersona.id, { replayOfId: result.conversationId, observationFocus: focus }) : undefined}
              replayBusy={entryBusy}
              onBranch={(turnNumber, text) => branch(turnNumber, text)}
            />}
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
