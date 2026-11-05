import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, ConversationResult, ConversationStartOptions, Material, Persona } from "./domain/types";
import type { ProductCore } from "./domain/product-core";
import type { RoleCard } from "./domain/role-card";
import type { PostgameBasis } from "./shared/agent-contract";
import { BusyHint } from "./ui/BusyHint";
import { CardsView, HistoryView, MaterialsView, ResearchReportView, RolesView } from "./ui/CatalogViews";
import { DeskPet, type DeskPetHandle, type PetExpression, type QuickRingAction } from "./ui/DeskPet";
import { PetDemoConsole } from "./ui/PetDemoConsole";
import { settleHiddenCards, type HiddenCardChoice } from "./ui/HiddenCards";
import { LeftRail, type AppView } from "./ui/LeftRail";
import { ResultStep } from "./ui/ResultStep";
import { SetupAct } from "./ui/SetupAct";
import { TableAct } from "./ui/TableAct";
import { WireframePrototype } from "./ui/wireframe-prototype";
import { createAgentClient, type AgentClient } from "./ui/agent-client";
import { buildPetChatContext, lastGameOf, managerTurnCount, newlyPlayedCard } from "./ui/pet-game-context";
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
  // 「经理出卡」事件基线(工单 16):按对局记已见经理轮数,只在新增时发触发。
  const seenManagerTurnsRef = useRef<{ id: string; count: number }>({ id: "", count: 0 });
  // 一键演示(工单 10):控制条开关与演示期间的桌宠表情接管。
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoExpression, setDemoExpression] = useState<PetExpression | null>(null);
  // 桌宠命令接口(工单 15):App 只发命令(openPanel/sendAsUser/react/refreshPolicy),
  // 不再拼 nonce/计数器,也不需要知道桌宠内部状态的名字。
  const petRef = useRef<DeskPetHandle>(null);
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

  // 一键演示入口(工单 10):URL 带 ?demo=pet 直接开演;对话输入「演示」同效。
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "pet") setDemoOpen(true);
  }, []);

  // 举牌即事件(工单 12→16):有牌举着待决定,发 table 触发由 Worker 落表情(pout)。
  useEffect(() => {
    if (raisePending && conversation?.status === "ongoing") {
      void agent
        .sendTrigger({ source: "table", kind: "hidden-raised", data: { gameId: conversation.id } })
        .catch(() => undefined);
    }
  }, [raisePending, conversation, agent]);

  const publishedCards = useMemo(
    () => materials.flatMap((material) => material.cards.filter((card) => card.status === "published")),
    [materials],
  );
  const allCards = useMemo(
    () => materials.flatMap((material) => material.cards),
    [materials],
  );
  const seatedPersona = personas.find((p) => p.id === conversation?.personaId) ?? null;
  // 牌局快照(工单 16):App 现成状态折成 ChatContext,随 chat 触发给桌宠;
  // 只进桌宠提示词,服务端落账前剔除——隐藏牌绝不进经理上下文。
  const petChatContext = useMemo(
    () =>
      buildPetChatContext({
        view,
        conversation,
        hiddenChoices: hiddenChoicesByCall[conversation?.id ?? ""] ?? {},
        lastGame: lastGameOf(result ? { outcome: result.outcome, endReason: result.endReason } : null, conversations),
      }),
    [view, conversation, hiddenChoicesByCall, result, conversations],
  );
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
   * 快捷环跳转(工单 10,spec 故事 8):回话由 Agent 照回,这里只管真的跳——
   * 换个客户→布置/名册,再来一局→重开本局(同客重试),上局复盘→结算/记录,
   * 本周投研→布置幕的情报档案夹(投研弹药库)并滚到它跟前。
   */
  function handleQuickAction(action: QuickRingAction) {
    if (action === "换个客户") {
      setView("setup");
      return;
    }
    if (action === "再来一局") {
      if (seatedPersona) {
        void connect(seatedPersona.id, result ? { replayOfId: result.conversationId } : undefined);
      } else {
        void quickStart();
      }
      return;
    }
    if (action === "上局复盘") {
      if (result) setView("postgame");
      else if (conversation?.status === "ended") void openHistory(conversation);
      else setView("history");
      return;
    }
    setView("setup");
    window.requestAnimationFrame(() => {
      document.querySelector(".setup-research-dock")?.scrollIntoView({ block: "center" });
    });
  }

  /** 关演示:表情与面板一并还给正常交互。 */
  function closeDemo() {
    setDemoOpen(false);
    setDemoExpression(null);
    petRef.current?.closePanel();
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
                onHiddenChoice={(item, choice) => {
                  setHiddenChoicesByCall((current) => ({
                    ...current,
                    [conversation.id]: { ...(current[conversation.id] ?? {}), [item]: choice },
                  }));
                  // 亲手翻开隐藏牌→发 table 触发,Worker 落 cheer(工单 16:表情由事件驱动)。
                  if (choice === "flip") {
                    void agent
                      .sendTrigger({ source: "table", kind: "hidden-revealed", data: { gameId: conversation.id, item } })
                      .catch(() => undefined);
                  }
                }}
                onRaisePendingChange={setRaisePending}
                onConversationChange={(next) => {
                  const accept = (current: Conversation) => next.revision === undefined || current.revision === undefined || next.revision >= current.revision;
                  setConversation((current) => (current?.id === next.id && accept(current) ? next : current));
                  setConversations((current) => current.map((item) => item.id === next.id && accept(item) ? next : item));
                  // 经理出了新的一张卡→发 table 触发,Worker 落 think(工单 16)。
                  // 只对「新增的经理轮」发:换局/找回旧局先记基线,不回放历史出卡。
                  const played = newlyPlayedCard(next.turns, next.resources?.cards ?? []);
                  const seen = seenManagerTurnsRef.current;
                  if (next.status === "ongoing" && seen.id === next.id) {
                    if (managerTurnCount(next.turns) > seen.count && played) {
                      void agent
                        .sendTrigger({
                          source: "table",
                          kind: "card-played",
                          data: { gameId: next.id, cardId: played.cardId, cardName: played.cardName },
                        })
                        .catch(() => undefined);
                    }
                    seenManagerTurnsRef.current = { id: next.id, count: managerTurnCount(next.turns) };
                  } else {
                    seenManagerTurnsRef.current = { id: next.id, count: managerTurnCount(next.turns) };
                  }
                }}
                onFinished={(finished) => {
                  setResult(finished);
                  setConversation((current) => (current ? { ...current, status: "ended" } : current));
                  setView((current) => (current === "table" ? "postgame" : current));
                  petRef.current?.react({ kind: "call-ended" }); // 挂断→桌宠挥手(工单 12)
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
      {/* 一键演示控制条(工单 10):右上角,按脚本驱动 7 幕;桌宠表情与面板由演示经命令接口接管。
          焦点语义(工单 15):chat 开对话面板;todo 定位最早待拍板卡;log 展开工作日志;none 收起。 */}
      {demoOpen && (
        <PetDemoConsole
          agent={agent}
          onPetExpression={setDemoExpression}
          onFocusPanel={(panel) => {
            const pet = petRef.current;
            if (!pet) return;
            if (panel === "none") pet.closePanel();
            else if (panel === "chat") pet.openPanel();
            else pet.openPanel({ locate: panel });
          }}
          onChat={(text) => petRef.current?.sendAsUser(text)}
          onPolicyChange={() => petRef.current?.refreshPolicy()}
          onClose={closeDemo}
        />
      )}
      {/* 桌宠固定在牌桌右下角,不参与布局,也不遮挡主内容(工单 15:单面板,App 只发命令)。
          单击头像进对话面板;通话中照样能聊(消息不进经理上下文);
          表情由牌局事件驱动(工单 16):经理出卡/举牌/翻牌走 table 触发,Worker 落表情,
          挂断走命令接口,复盘「欢呼」随 game-ended 的 Report 来,App 不再用 prop 切表情;
          演示期间表情由演示脚本接管(工单 10)。 */}
      <DeskPet
        ref={petRef}
        agent={agent}
        inCall={view === "table" && conversation?.status === "ongoing"}
        onQuickAction={handleQuickAction}
        onOpenDemo={() => setDemoOpen(true)}
        view={view}
        chatContext={petChatContext}
        demoExpression={demoExpression}
      />
    </div>
  );
}
