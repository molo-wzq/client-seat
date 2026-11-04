import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, ConversationResult, ConversationStartOptions, Material, Persona } from "./domain/types";
import type { ProductCore } from "./domain/product-core";
import type { RoleCard } from "./domain/role-card";
import type { PostgameBasis } from "../server/agent/types";
import { BusyHint } from "./ui/BusyHint";
import { CardsView, HistoryView, MaterialsView, ResearchReportView, RolesView } from "./ui/CatalogViews";
import { DeskPet } from "./ui/DeskPet";
import { settleHiddenCards, type HiddenCardChoice } from "./ui/HiddenCards";
import { LeftRail, type AppView } from "./ui/LeftRail";
import { ResultStep } from "./ui/ResultStep";
import { SetupAct } from "./ui/SetupAct";
import { TableAct } from "./ui/TableAct";
import { WireframePrototype } from "./ui/wireframe-prototype";
import { createAgentClient, type AgentClient } from "./ui/agent-client";
import { playSfx } from "./ui/game-feel";

/** 缺省桌宠 agent 客户端(与 DeskPet 的实例同理,无状态,可各持一个)。 */
const defaultPetAgent = createAgentClient();

/** 桌宠复盘一句话的视图(工单 06):一句话 + 展开用的依据。 */
type PetReviewView = { text: string; basis: PostgameBasis };

export function App({ api, agent = defaultPetAgent }: { api: ProductCore; agent?: AgentClient }) {
  const [view, setView] = useState<AppView>("setup");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [roles, setRoles] = useState<RoleCard[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [result, setResult] = useState<ConversationResult | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  // 隐藏牌(工单 04):玩家「翻/先藏着」的选择只存客户端,按局归档;结算时用于揭晓。
  const [hiddenChoicesByCall, setHiddenChoicesByCall] = useState<Record<string, Record<string, HiddenCardChoice>>>({});
  const [raisePending, setRaisePending] = useState(false);
  // 桌宠复盘一句话(工单 06):对局结束发 game-ended 触发后,ready Report 送达即显示;
  // ref 缓存避免同一局来回进出结算时重复触发。
  const [petReview, setPetReview] = useState<PetReviewView | null>(null);
  const petReviewRef = useRef<PetReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollIntoView?.({ block: "start" });
    if (!catalogBusy) mainRef.current?.focus({ preventScroll: true });
  }, [view, conversation?.id, catalogBusy]);

  async function refreshCatalog() {
    const [nextPersonas, nextMaterials, nextConversations, nextRoles] = await Promise.all([
      api.listPersonas(),
      api.listMaterials(),
      api.listConversations(),
      // 接口桩可能没有角色方法:取不到就空列表,布置幕回落默认卡。
      typeof api.listRoles === "function" ? api.listRoles() : Promise.resolve([] as RoleCard[]),
    ]);
    setPersonas(nextPersonas);
    setMaterials(nextMaterials);
    setConversations(nextConversations);
    setRoles(nextRoles);
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

  /**
   * 对局结束进结算(工单 06):自动发 table/game-ended 触发,桌宠后台起草
   * 「经理哪招值得学」;ready 才显示,dropped 就保持沉默。同一局只发一次。
   */
  function requestPetReview(next: ConversationResult) {
    const cached = petReviewRef.current;
    if (cached && cached.basis.gameId === next.conversationId) {
      setPetReview(cached);
      return;
    }
    setPetReview(null);
    const cards = next.resources?.cards ?? [];
    const hidden = next.resources?.persona?.hidden ?? [];
    const rounds = next.turns
      .filter((turn) => turn.speaker === "manager")
      .map((turn) => ({ managerText: turn.text, ...(turn.usedCardId ? { cardId: turn.usedCardId } : {}) }));
    const hiddenUnrevealedCount = hidden.length
      ? settleHiddenCards(hidden, next.turns, cards, hiddenChoicesByCall[next.conversationId] ?? {}).filter(
          (card) => !card.revealed,
        ).length
      : 0;
    void agent
      .sendTrigger({
        source: "table",
        kind: "game-ended",
        data: { gameId: next.conversationId, rounds, hiddenUnrevealedCount },
      })
      .then((outcome) => {
        const report = outcome.report;
        if (report && report.status === "ready" && report.basis && report.basis.gameId === next.conversationId) {
          const review = { text: report.text, basis: report.basis };
          petReviewRef.current = review;
          setPetReview(review);
        }
      })
      .catch(() => undefined);
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
      requestPetReview(nextResult);
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
        roleCount={roles.length}
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
                roles={roles}
                onConnect={(personaId, roleId) => void connect(personaId, roleId ? { roleId } : undefined)}
                onCatalogChange={() => void refreshCatalog()}
                onOpenFullReport={() => setView("research")}
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
                hiddenChoices={hiddenChoicesByCall[conversation.id] ?? {}}
                onHiddenChoice={(item, choice) =>
                  setHiddenChoicesByCall((current) => ({
                    ...current,
                    [conversation.id]: { ...(current[conversation.id] ?? {}), [item]: choice },
                  }))
                }
                onRaisePendingChange={setRaisePending}
                onConversationChange={(next) => {
                  const accept = (current: Conversation) => next.revision === undefined || current.revision === undefined || next.revision >= current.revision;
                  setConversation((current) => current?.id === next.id && accept(current) ? next : current);
                  setConversations((current) => current.map((item) => item.id === next.id && accept(item) ? next : item));
                }}
                onFinished={(finished) => {
                  setResult(finished);
                  setConversation((current) => (current ? { ...current, status: "ended" } : current));
                  setView((current) => current === "table" ? "postgame" : current);
                  requestPetReview(finished);
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
              onReplay={seatedPersona ? () => void connect(seatedPersona.id, { replayOfId: result.conversationId }) : undefined}
              replayBusy={entryBusy}
              onBranch={(turnNumber, text) => branch(turnNumber, text)}
              hiddenChoices={hiddenChoicesByCall[result.conversationId] ?? {}}
              petReview={petReview}
            />}
            {view === "materials" && (
              <MaterialsView api={api} materials={materials} onPublished={() => void refreshCatalog()} />
            )}
            {view === "cards" && <CardsView cards={allCards} />}
            {view === "roles" && (
              <RolesView api={api} roles={roles} onRolesChange={() => void refreshCatalog()} />
            )}
            {view === "research" && <ResearchReportView />}
            {view === "history" && (
              <HistoryView conversations={conversations} personas={personas} onOpen={(item) => void openHistory(item)} />
            )}
          </>
        )}
      </main>
      {/* 桌宠固定在牌桌右下角,不参与布局,也不遮挡主内容。
          对局进行中(主幕 + ongoing)命令条置灰(工单 03);
          有隐藏牌举着待决定时表情变「拿笔想」(工单 04);
          进结算后变「欢呼」,陪着看经理的复盘一句话(工单 06)。 */}
      <DeskPet
        inCall={view === "table" && conversation?.status === "ongoing"}
        expression={
          view === "postgame"
            ? "cheer"
            : raisePending && view === "table" && conversation?.status === "ongoing"
              ? "think"
              : "wave"
        }
      />
    </div>
  );
}
