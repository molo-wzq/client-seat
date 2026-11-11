import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { reducedMotion } from "./game-feel";
import { createAgentClient, type AgentClient } from "./agent-client";
import { PetChatPanel } from "./PetChatPanel";
import { resolveExpression, type PetReactionEvent, type QuickRingAction } from "./pet-reactions";
import { expressionLabel, petImg, variantLabel } from "./pet-assets";
import { useChatSession } from "./use-chat-session";
import { usePetMood } from "./use-pet-mood";
import { usePetPosition } from "./use-pet-position";
import { useAgentView } from "./use-agent-view";
import { buildTraceSteps, mergeWorkLog, type TraceStep } from "./agent-trace";
import type { ChatContext, PetEmotion } from "../shared/agent-contract";
import { XIAOBEI_BUBBLE_CHARS } from "../shared/agent-contract";
import { shortcutFromUtterance } from "./slash-commands";
import "./desk-pet.css";

/** 桌宠版式:女版 / 男版。 */
export type PetVariant = "f" | "m";

/**
 * 桌宠表情:挥手笑 / 拿笔想 / 欢呼 / 打瞌睡 / 鼓腮。
 * 类型统一用契约里的 PetEmotion(工单 15),这里只留别名兼容既有引用。
 */
export type PetExpression = PetEmotion;

/** 快捷动作(工单 10→15):回复建议按钮与 / 命令共用,App 按动作决定去哪个视图。 */
export type { QuickRingAction, PetReactionEvent } from "./pet-reactions";

/**
 * App 驱动桌宠的窄接口(工单 15):命令接口取代 nonce/计数器式 props,
 * App 只发命令,不再知道桌宠内部状态的名字。
 */
export interface DeskPetHandle {
  /** 打开面板;locate 指定到位点——todo 滚到最早一张待拍板卡,log 展开工作日志。 */
  openPanel(options?: { locate?: "todo" | "log" }): void;
  closePanel(): void;
  /** 演示代发一句对话(工单 15):如同玩家亲手输入,不写面板开合。 */
  sendAsUser(text: string): void;
  /** 事件反应:翻牌/举牌/挂断换表情(短时)。 */
  react(event: PetReactionEvent): void;
  /** 放权被外部(演示脚本)切过:开着的面板重拉,开关立即同步。 */
  refreshPolicy(): void;
}

const VARIANT_KEY = "desk-pet-variant";
const defaultAgent = createAgentClient();

/** 面板内定位滚动:jsdom 没有 scrollIntoView,可选调用不炸测试环境。 */
function scrollIntoViewSafe(root: HTMLElement | null, selector: string): void {
  root?.querySelector(selector)?.scrollIntoView?.({ block: "nearest" });
}

function loadVariant(): PetVariant {
  try {
    return window.localStorage.getItem(VARIANT_KEY) === "m" ? "m" : "f";
  } catch {
    return "f"; // 存储被禁用也不崩(审查 R10)
  }
}

/**
 * 桌宠在牌桌一角陪客户看局(工单 15):只留头像和角标,一个面板以对话为主体——
 * 顶部 Agent 状态条(两档放权+工作日志),待拍板卡插进对话流,⋯ 菜单收编常驻按钮。
 * 消息状态在 useChatSession,互动感在 usePetMood,位置在 usePetPosition,
 * 工单/放权数据在 useAgentView,App 经 DeskPetHandle 发命令。
 * 通话中玩家点头像打开同一块面板,顶上引用当前经理原话;不主动弹面板或气泡。
 */
export function DeskPet({
  expression = "wave",
  inCall = false,
  agent = defaultAgent,
  onQuickAction,
  onOpenDemo,
  view,
  chatContext = null,
  gameId,
  showDemoControls = false,
  demoExpression = null,
  ref,
}: {
  expression?: PetExpression;
  inCall?: boolean;
  agent?: AgentClient;
  /** 快捷芯片跳转(工单 10):回话照发,App 按动作跳到对应视图。 */
  onQuickAction?: (action: QuickRingAction) => void;
  /** 对话输入「演示」时唤出一键演示(工单 10);URL ?demo=pet 同效。 */
  onOpenDemo?: () => void;
  /** 当前页面名(工单 11 view):进对话上下文,桌宠回话结合所在页。 */
  view?: string;
  /** 牌局快照(工单 16):App 组装,随 chat 触发给桌宠(只进桌宠提示词,落账前剔除)。 */
  chatContext?: ChatContext | null;
  gameId?: string;
  showDemoControls?: boolean;
  /** 演示接管的表情(审查 B1):非空时压过一切内部状态;null 表示还回去。 */
  demoExpression?: PetExpression | null;
  ref?: Ref<DeskPetHandle>;
}) {
  const [variant, setVariant] = useState<PetVariant>(loadVariant);
  const [dnd, setDnd] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  /* 单面板(工单 15):开合、⋯ 菜单、工作日志。 */
  const [panelOpen, setPanelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  /** 工作日志高亮定位的工单号(工单 15:回复里的工单点开)。 */
  const [logHighlight, setLogHighlight] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const panelOpenRef = useRef(false);

  const mood = usePetMood({ onSingleClick: () => (panelOpenRef.current ? closePanel() : openPanel()) });
  const position = usePetPosition({ rootRef, onInteract: mood.wake });
  const sayRef = useRef(mood.say);
  const inCallRef = useRef(inCall);
  const session = useChatSession({
    agent,
    view,
    chatContext,
    gameId,
    onOpenDemo,
    onPetReply: (message) => {
      if (!panelOpenRef.current && !inCallRef.current) {
        sayRef.current([...message.body].slice(0, XIAOBEI_BUBBLE_CHARS).join(""));
      }
    },
  });
  const showAgentControls = true;
  void showDemoControls;
  const agentView = useAgentView(agent);
  // 事件回调经 ref 取最新实现(会话/情绪/视图每次渲染都是新对象),订阅 effect 才能只依赖 agent。
  const sessionRef = useRef(session);
  const expressRef = useRef(mood.express);
  const upsertReportRef = useRef(agentView.upsertReport);
  useEffect(() => {
    sessionRef.current = session;
    sayRef.current = mood.say;
    expressRef.current = mood.express;
    inCallRef.current = inCall;
    upsertReportRef.current = agentView.upsertReport;
  });

  function openPanel(locate?: "todo" | "log"): void {
    mood.wake(); // 开面板也是互动:顺便叫醒(审查 S5)
    setPanelOpen(true);
    setMenuOpen(false);
    if (locate === "log") setLogOpen(true);
    // todo 定位:面板挂上后滚到最早一张待拍板卡(微任务后查 DOM)。
    if (locate === "todo") {
      window.setTimeout(() => {
        scrollIntoViewSafe(rootRef.current, ".desk-pet-card[data-status='waiting']");
      }, 0);
    }
  }

  function closePanel(): void {
    setPanelOpen(false);
    setMenuOpen(false);
    setLogOpen(false);
    setLogHighlight(null);
    session.resetEmotion();
    avatarRef.current?.focus(); // 焦点还给头像(审查 S7)
  }

  /** 回复里的工单点开(工单 15):展开工作日志、高亮这张工单并滚到它跟前。 */
  function locateTicket(ticketId: string): void {
    setLogOpen(true);
    setLogHighlight(ticketId);
    window.setTimeout(() => {
      scrollIntoViewSafe(rootRef.current, ".desk-pet-log-row[data-highlight]");
    }, 0);
  }

  /** 状态条开合工作日志:收起时清掉定位高亮。 */
  function toggleLog(): void {
    const next = !logOpen;
    setLogOpen(next);
    if (!next) setLogHighlight(null);
  }

  /** / 命令:同一句话进会话,并做对应的跳转。不另开一张对话工单。 */
  function runQuickAction(label: string) {
    mood.wake();
    session.send(label);
    onQuickAction?.(label as QuickRingAction);
    closePanel();
  }

  /** 拍板(工单 15 待拍板卡):决定作为命令发回 Router,工单随后自己变状态。 */
  function decide(ticketId: string, verb: "同意" | "驳回") {
    agentView.sendCommand(`${verb} ${ticketId}`);
  }

  function switchVariant() {
    const next: PetVariant = variant === "f" ? "m" : "f";
    setVariant(next);
    try {
      window.localStorage.setItem(VARIANT_KEY, next);
    } catch {
      // 隐私模式写不进就算了,本次会话内切换仍生效。
    }
  }

  // Ctrl+K 全局唤出面板(工单 12→15 收口,审查 R3):只认 Ctrl,⌘K 留给浏览器;勿扰时忽略。
  // 面板开合只碰 panelOpenRef/dndRef 与稳定 setter,依赖空数组不会读到旧状态。
  const dndRef = useRef(false);
  useEffect(() => {
    dndRef.current = dnd;
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || e.metaKey) return; // 只认 Ctrl+K,不抢 ⌘K(审查 R3)
      if (e.key.toLowerCase() !== "k") return;
      if (dndRef.current) return; // 勿扰中不唤出,退出勿扰也不补弹(审查 R3)
      e.preventDefault();
      if (panelOpenRef.current) closePanel();
      else openPanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openPanel/closePanel 只用稳定 setter/ref
  }, []);

  // 面板开合同步:红点让位/清掉(会话),拉取放权与评估(失败给空态)。
  useEffect(() => {
    panelOpenRef.current = panelOpen;
    sessionRef.current.markVisible(panelOpen);
    if (panelOpen) agentView.refreshPolicy();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshPolicy 只读 agent 与稳定 setter
  }, [panelOpen, agent]);

  // 订阅 agent 事件流:report 刷新工单视图与评估,对话部分交给 useChatSession,
  // pet-bubble 出气泡(面板开着或通话中不弹)。
  // 非对话工单的 Report 带表情(工单 16:牌局事件/复盘)→ 桌宠直接做短时微反应。
  useEffect(() => {
    return agent.onEvent((event) => {
      if (event.type === "report") {
        upsertReportRef.current(event.report);
        if (event.report.emotion && !sessionRef.current.ownsTicket(event.report.ticketId)) {
          expressRef.current(event.report.emotion);
        }
      }
      sessionRef.current.applyEvent(event);
      if (event.type === "channel" && event.channel.target === "pet-bubble") {
        if (!panelOpenRef.current && !inCallRef.current) sayRef.current(event.channel.text);
      }
    });
  }, [agent]);

  // App 的命令接口(工单 15):openPanel/closePanel/sendAsUser/react/refreshPolicy。
  useImperativeHandle(ref, () => ({
    openPanel: (options) => openPanel(options?.locate),
    closePanel,
    sendAsUser: (text) => {
      mood.wake();
      session.send(text);
    },
    react: (event) => mood.reactTo(event),
    refreshPolicy: agentView.refreshPolicy,
  }));

  function onAvatarClick(e: React.MouseEvent) {
    if (position.draggedRef.current) {
      position.draggedRef.current = false;
      return; // 拖完松手的补偿 click 不算
    }
    mood.handleAvatarClick(e.detail);
  }

  // 有效表情(工单 15):优先级归并在 pet-reactions(演示接管最高,审查 B1/S5)。
  const shownExpression: PetExpression = resolveExpression({
    demo: demoExpression,
    dragging: position.dragging,
    reaction: mood.reactionExpr,
    poke: mood.pokeExpression,
    chat: session.chatEmotion,
    sleepy: mood.sleepy,
    base: expression,
  });

  // 待人决定与受阻的工单(spec 故事 11/16):角标数量、待拍板卡都由它驱动。
  const pendingTickets = agentView.tickets.filter((ticket) => ticket.status === "waiting" || ticket.status === "blocked");
  const runningCount = agentView.tickets.filter((ticket) => ticket.status === "progress").length;

  // 轨迹行(工单 15):对话里每条桌宠回复按工单号归并「做了什么」,账本里没有的回复不给。
  const traceByTicket = new Map<string, TraceStep[]>();
  for (const message of session.messages) {
    if (message.speaker !== "pet" || !message.ticketId || traceByTicket.has(message.ticketId)) continue;
    traceByTicket.set(message.ticketId, buildTraceSteps(message.ticketId, agentView.tickets, agentView.evals));
  }
  const chatTraces = [...traceByTicket]
    .filter(([, steps]) => steps.length > 0)
    .map(([ticketId, steps]) => ({ ticketId, steps }));

  const anchored = position.pos ? { left: position.pos.left, top: position.pos.top, right: "auto", bottom: "auto" } : undefined;
  const avatarAlt = `桌宠·${variantLabel[variant]}·${expressionLabel[shownExpression]}`;

  const focusTurn = chatContext?.phase === "game" ? chatContext.focusTurn : undefined;

  // 头顶悬浮栈:气泡在上、面板贴身,右对齐不遮主内容。
  const popovers = (
    <div className="desk-pet-popovers">
      {dropHover && !dnd && <p className="desk-pet-drop-hint">交给我</p>}
      {mood.bubble !== null && !dnd && !inCall && (
        <p className="desk-pet-bubble" role="status" aria-label="桌宠气泡">
          {mood.bubble}
        </p>
      )}
      {panelOpen && !dnd && (
        <PetChatPanel
          messages={session.messages}
          focusTurn={focusTurn}
          notebook={{
            notes: session.notes, save: session.saveNote, remove: session.deleteNote,
            activeStep: session.activeStep, showAgentControls,
          }}
          awaitingReply={session.awaitingReply}
          tickets={showAgentControls ? pendingTickets : []}
          annotating={session.annotating}
          policy={agentView.policy}
          runningCount={runningCount}
          variant={variant}
          menuOpen={menuOpen}
          logOpen={logOpen}
          workLog={mergeWorkLog(agentView.tickets, agentView.evals)}
          logHighlightTicketId={logHighlight ?? undefined}
          traces={chatTraces}
          onSend={(text) => {
            mood.wake();
            session.send(text);
            const shortcut = shortcutFromUtterance(text);
            if (shortcut) onQuickAction?.(shortcut);
          }}
          onClose={closePanel}
          onClear={session.clearHistory}
          onQuickAction={runQuickAction}
          onLocateTicket={locateTicket}
          onApprove={(ticketId) => decide(ticketId, "同意")}
          onReject={(ticketId) => decide(ticketId, "驳回")}
          onRevise={session.quote}
          onSetMode={agentView.setMode}
          onToggleMenu={() => setMenuOpen((open) => !open)}
          onSwitchVariant={switchVariant}
          onDnd={() => setDnd(true)}
          onToggleLog={toggleLog}
        />
      )}
    </div>
  );

  if (dnd) {
    return (
      <aside ref={rootRef} className="desk-pet desk-pet-collapsed" aria-label="桌宠" data-variant={variant} data-dnd="true" style={anchored}>
        <button
          type="button"
          className="desk-pet-restore"
          aria-label="桌宠勿扰中,点击恢复"
          onClick={() => {
            setDnd(false);
            mood.wake();
          }}
        >
          <img src={petImg[variant][shownExpression]} alt="" draggable={false} />
        </button>
        {popovers}
      </aside>
    );
  }

  return (
    <aside
      ref={rootRef}
      className="desk-pet"
      aria-label="桌宠"
      data-variant={variant}
      data-expression={shownExpression}
      data-dragging={position.dragging || undefined}
      data-drop-hover={dropHover || undefined}
      data-reduced-motion={reducedMotion() || undefined}
      data-panel-open={(panelOpen && !dnd) || undefined}
      style={anchored}
      onDragOver={(e) => {
        if (!showAgentControls) return;
        e.preventDefault(); // 允许松手
        setDropHover(true);
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        if (!showAgentControls) return;
        setDropHover(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        agentView.sendDroppedFiles(files);
        // 文件同时作为附件消息进对话(工单 15):看得见「给了它什么」。
        session.attachFiles(files.map((file) => file.name));
      }}
    >
      <div className="desk-pet-avatar-wrap">
        <button
          ref={avatarRef}
          type="button"
          className="desk-pet-avatar"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onPointerDown={position.onAvatarPointerDown}
          onClick={onAvatarClick}
          onContextMenu={(e) => {
            e.preventDefault(); // 右键头像同样能打开 ⋯ 菜单(工单 15)
            setPanelOpen(true);
            setMenuOpen(true);
          }}
        >
          <img src={petImg[variant][shownExpression]} alt={avatarAlt} draggable={false} />
        </button>
        {pendingTickets.length > 0 && (
          <button
            type="button"
            className="desk-pet-badge"
            key={`badge-${pendingTickets.length}-${agentView.todoShake}`}
            aria-label={`待办 ${pendingTickets.length}`}
            onClick={(e) => {
              e.stopPropagation(); // 点角标开面板并定位待拍板卡,不触发头像的单击判定
              openPanel("todo");
            }}
          >
            {pendingTickets.length}
          </button>
        )}
        {session.chatDot && <span className="desk-pet-dot" role="status" aria-label="有新回复" />}
      </div>
      {popovers}
    </aside>
  );
}
