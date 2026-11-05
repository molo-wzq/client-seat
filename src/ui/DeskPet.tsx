import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./game-feel";
import { createAgentClient, type AgentClient } from "./agent-client";
import { PetChatPanel, type PetChatMessage } from "./PetChatPanel";
import {
  IDLE_SLEEP_MS,
  REACTION_HOLD_MS,
  pokeLine,
  reactionExpression,
  type PetReactionEvent,
  type QuickRingAction,
} from "./pet-reactions";
import type {
  AcceptMode,
  AgentEvalRecord,
  AgentPolicy,
  AgentReport,
  AgentTicketView,
  ReportStatus,
} from "../../server/agent/types";
import fCheer from "../assets/desk-pet/f-cheer.webp";
import fPout from "../assets/desk-pet/f-pout.webp";
import fSleepy from "../assets/desk-pet/f-sleepy.webp";
import fThink from "../assets/desk-pet/f-think.webp";
import fWave from "../assets/desk-pet/f-wave.webp";
import mCheer from "../assets/desk-pet/m-cheer.webp";
import mPout from "../assets/desk-pet/m-pout.webp";
import mSleepy from "../assets/desk-pet/m-sleepy.webp";
import mThink from "../assets/desk-pet/m-think.webp";
import mWave from "../assets/desk-pet/m-wave.webp";
import "./desk-pet.css";

/** 桌宠版式:女版 / 男版。 */
export type PetVariant = "f" | "m";

/** 桌宠表情:挥手笑 / 拿笔想 / 欢呼 / 打瞌睡 / 鼓腮。 */
export type PetExpression = "wave" | "think" | "cheer" | "sleepy" | "pout";

/** 快捷芯片动作(工单 10→12):面板芯片与回复建议共用,App 按动作决定去哪个视图。 */
export type { QuickRingAction, PetReactionEvent } from "./pet-reactions";

type PetPos = { left: number; top: number };

const VARIANT_KEY = "desk-pet-variant";
const POS_KEY = "desk-pet-pos";
/** 对话历史(工单 12):本地存最近 50 条,可清空。 */
const CHAT_KEY = "desk-pet-chat";
const CHAT_HISTORY_MAX = 50;
/** 进模型的对话历史轮数(spec:history 最近 N 轮;一轮 = 玩家 + 桌宠各一句)。 */
const CHAT_HISTORY_MESSAGES = 16;

/** 工单状态徽标文案(spec 故事 10:进展、等待、就绪、受阻、失败;放弃补全)。 */
const STATUS_LABEL: Record<ReportStatus, string> = {
  progress: "进展",
  waiting: "等待",
  ready: "就绪",
  blocked: "受阻",
  failed: "失败",
  dropped: "已放弃",
};

/** 刚领走还没汇报的工单给的占位文案。 */
const NO_REPORT_TEXT = "刚领走，还没汇报";

/** 放权模式三段开关(工单 08):off 关 / observe 观察 / auto 自动,文案与按钮一一对应。 */
const ACCEPT_MODE_OPTIONS: ReadonlyArray<{ mode: AcceptMode; label: string }> = [
  { mode: "off", label: "关" },
  { mode: "observe", label: "观察" },
  { mode: "auto", label: "自动" },
];

/** 评估记录的处置标签:observe 只记录未执行,auto 已立项执行。 */
const EVAL_OUTCOME_LABEL: Record<AgentEvalRecord["outcome"], string> = {
  observed: "只记录",
  executed: "已执行",
};

/** 评估记录时间只显时分(账本 at 是 ISO 串,按本地时区取 HH:MM)。 */
function formatEvalTime(at: string): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 拖入文件的类型(demo,工单 07):按 MIME 与文件名推断——音频 / 生客画像 / 角色卡。 */
function inferFileKind(file: { name: string; type: string }): "audio" | "persona" | "role" {
  if (file.type.startsWith("audio/")) return "audio";
  return /角色|role/i.test(file.name) ? "role" : "persona";
}

/**
 * 一条 Report 落到工单视图上:按工单号原位更新,没有则追加(与 foldTickets 同一规则)。
 * UI 只读账本视图:report 事件到达即刷新,SSE 断流时以 tickets() 拉取为底。
 */
function upsertTicket(prev: AgentTicketView[], report: AgentReport): AgentTicketView[] {
  const next: AgentTicketView = { ticketId: report.ticketId, status: report.status, text: report.text };
  return prev.some((ticket) => ticket.ticketId === report.ticketId)
    ? prev.map((ticket) => (ticket.ticketId === report.ticketId ? next : ticket))
    : [...prev, next];
}

/** 桌宠气泡硬上限 40 字(spec):服务端已截一道,前端展示再兜底。 */
function clampBubble(text: string): string {
  return [...text].slice(0, 40).join("");
}

/** 本地对话历史(工单 12):只认 {speaker,text[,quickActions]},坏数据当空。 */
function loadChat(): PetChatMessage[] {
  try {
    const raw = window.localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { speaker: "player" | "pet"; text: string; quickActions?: string[] } =>
          typeof item === "object" &&
          item !== null &&
          ((item as { speaker?: unknown }).speaker === "player" || (item as { speaker?: unknown }).speaker === "pet") &&
          typeof (item as { text?: unknown }).text === "string",
      )
      .slice(-CHAT_HISTORY_MAX)
      .map((item, index) => ({ key: `h${index}`, ...item }));
  } catch {
    return [];
  }
}

/** 缺省 agent 客户端:浏览器全局 fetch/EventSource;测试注入假实现。 */
const defaultAgent = createAgentClient();

const petImg: Record<PetVariant, Record<PetExpression, string>> = {
  f: { wave: fWave, think: fThink, cheer: fCheer, sleepy: fSleepy, pout: fPout },
  m: { wave: mWave, think: mThink, cheer: mCheer, sleepy: mSleepy, pout: mPout },
};
const variantLabel: Record<PetVariant, string> = { f: "女版", m: "男版" };
const expressionLabel: Record<PetExpression, string> = {
  wave: "挥手笑",
  think: "拿笔想",
  cheer: "欢呼",
  sleepy: "打瞌睡",
  pout: "鼓腮",
};

function loadPos(): PetPos | null {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PetPos;
    return typeof parsed.left === "number" && typeof parsed.top === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function savePos(pos: PetPos) {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    // 隐私模式写不进就算了,本次会话内拖动仍生效。
  }
}

/**
 * 桌宠在牌桌一角陪客户看局(工单 01 外壳 + 工单 12 互动):
 * 单击头像优先进入对话(快捷环收进面板顶部成芯片),Ctrl+K 唤同一个面板;
 * 悬停探头、双击戳一下、拖动鼓腮、闲置 3 分钟打瞌睡、事件反应换表情。
 * 不说话评价玩家;inCall(对局中)只锁输入——芯片「再来一局」还得能按。
 * 工单 07:文件拖到桌宠上高亮「交给我」,松手交 Worker 起草进待审。
 * 工单 08:待办面板顶部放权模式三段开关(off/observe/auto)与评估记录列表。
 */
export function DeskPet({
  expression = "wave",
  inCall = false,
  agent = defaultAgent,
  onQuickAction,
  onOpenDemo,
  focusPanel = null,
  view,
  reaction = null,
  demoChatCue = null,
  onDemoChatDone,
}: {
  expression?: PetExpression;
  inCall?: boolean;
  agent?: AgentClient;
  /** 快捷芯片跳转(工单 10):回话照发,App 按动作跳到对应视图。 */
  onQuickAction?: (action: QuickRingAction) => void;
  /** 对话输入「演示」时唤出一键演示(工单 10);URL ?demo=pet 同效。 */
  onOpenDemo?: () => void;
  /** 演示要看的面板(工单 10→12):直接展开工单列表/待办面板/对话面板,演示结束还回去。 */
  focusPanel?: "tickets" | "inbox" | "chat" | null;
  /** 当前页面名(工单 11 view):进对话上下文,桌宠回话结合所在页。 */
  view?: string;
  /** 事件反应(工单 12):翻牌/举牌/挂断换表情,待审只晃角标;App 每次传新对象。 */
  reaction?: PetReactionEvent | null;
  /** 演示代发一句对话(工单 12):打开面板并发送,如同玩家亲手输入;nonce 保证只发一次。 */
  demoChatCue?: { nonce: number; text: string } | null;
  onDemoChatDone?: () => void;
}) {
  const [variant, setVariant] = useState<PetVariant>(
    () => (window.localStorage.getItem(VARIANT_KEY) === "m" ? "m" : "f"),
  );
  const [dnd, setDnd] = useState(false);
  const [pos, setPos] = useState<PetPos | null>(loadPos);
  const [dragging, setDragging] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [tickets, setTickets] = useState<AgentTicketView[]>([]);
  /** 待审卡的批注草稿(工单 07):按工单号各存一份,发送即清空。 */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dropHover, setDropHover] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /** 放权模式与评估记录(工单 08):待办面板打开时拉取,null 表示策略还没到。 */
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [evals, setEvals] = useState<AgentEvalRecord[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  // 拖动基线:按下时的指针与桌宠位置,移动按差值换算,jsdom 里 rect 为 0 也能算对差值。
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  // 按下后是否真的拖动过:拖完松手浏览器仍会补发 click,别让它误开对话面板。
  const draggedRef = useRef(false);

  /* ---- 对话(工单 12) ---- */
  const [chatOpen, setChatOpen] = useState(false);
  /** 事件回调里读最新开合状态,避免订阅 effect 的旧闭包。 */
  const chatOpenRef = useRef(false);
  const [messages, setMessages] = useState<PetChatMessage[]>(loadChat);
  /** 已发出还没见到回音:面板里显示「…」打字指示。 */
  const [awaitingReply, setAwaitingReply] = useState(false);
  /** 面板关闭时收到新回复:头像亮红点,打开面板即清。 */
  const [chatDot, setChatDot] = useState(false);
  /** 对话期间的表情覆盖:发送→think,回复到达→表情标签;面板收起即还回去。 */
  const [chatEmotion, setChatEmotion] = useState<PetExpression | null>(null);
  /** 已认定的对话工单号:发送回执与 delta 都会登记,Report 据此路由进对话。 */
  const chatTicketsRef = useRef<Set<string>>(new Set());
  const messageKeyRef = useRef(0);

  /* ---- 互动感(工单 12) ---- */
  const [pokeCount, setPokeCount] = useState(0);
  const [pokeExpression, setPokeExpression] = useState<PetExpression | null>(null);
  const pokeTimerRef = useRef<number | null>(null);
  const [reactionExpr, setReactionExpr] = useState<PetExpression | null>(null);
  const [sleepy, setSleepy] = useState(false);
  const [activityAt, setActivityAt] = useState(() => Date.now());
  /** 待审到达的节拍:驱动角标重挂载,重放「晃一下」动画。 */
  const [todoShake, setTodoShake] = useState(0);
  /** 演示代发只发一次:按 nonce 去重(StrictMode 重放 effect 也不重发)。 */
  const demoChatSentRef = useRef(-1);

  function nextMessageKey(): string {
    messageKeyRef.current += 1;
    return `m${messageKeyRef.current}`;
  }

  /** 追加并截到最近 50 条(工单 12):渲染与本地存储同一上限。 */
  function appendCapped(prev: PetChatMessage[], message: PetChatMessage): PetChatMessage[] {
    return [...prev, message].slice(-CHAT_HISTORY_MAX);
  }

  /** 任何与桌宠的互动都算活动:醒来并把闲置计时重置 3 分钟。 */
  function wake() {
    setSleepy(false);
    setActivityAt(Date.now());
  }

  function openChat() {
    chatOpenRef.current = true;
    setChatOpen(true);
    setChatDot(false);
    wake();
  }

  function closeChat() {
    chatOpenRef.current = false;
    setChatOpen(false);
    setChatEmotion(null); // 表情还给正常神态
  }

  /** 发一句对话(工单 11→12):带最近历史与所在页,回复从 delta/Report 流回来。 */
  function sendChat(text: string) {
    wake();
    setChatEmotion("think"); // 回复期间表情切 think(工单 12)
    setAwaitingReply(true);
    const history = messages
      .filter((message) => !message.streaming)
      .slice(-CHAT_HISTORY_MESSAGES)
      .map(({ speaker, text: messageText }) => ({ speaker, text: messageText }));
    setMessages((prev) => appendCapped(prev, { key: nextMessageKey(), speaker: "player", text }));
    agent
      .sendTrigger({ source: "pet", kind: "chat", data: { text, history, ...(view ? { view } : {}) } })
      .then((outcome) => {
        if (outcome.ticket) chatTicketsRef.current.add(outcome.ticket.id);
      })
      .catch(() => {
        setAwaitingReply(false);
        setChatEmotion(null);
        setMessages((prev) =>
          appendCapped(prev, { key: nextMessageKey(), speaker: "pet", text: "网络不顺，刚那句没发出去，再说一遍？" }),
        );
      });
  }

  /** 流式增量:按工单号拼接;首次到达创建流式条目(演示代发也走这里)。 */
  function applyDelta(ticketId: string, text: string) {
    chatTicketsRef.current.add(ticketId);
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.ticketId === ticketId && message.streaming);
      if (index >= 0) {
        const next = [...prev];
        const current = next[index]!;
        next[index] = { ...current, text: current.text + text };
        return next;
      }
      return appendCapped(prev, { key: nextMessageKey(), ticketId, speaker: "pet", text, streaming: true });
    });
    setAwaitingReply(false); // 正文开始上屏,「…」让位
    if (!chatOpenRef.current) setChatDot(true);
  }

  /** 对话 Report:只认对话工单号;ready 才定稿(取服务端权威全文),failed 等回退路径的最终稿。 */
  function applyChatReport(report: AgentReport) {
    if (!chatTicketsRef.current.has(report.ticketId)) return;
    if (report.status !== "ready") return;
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.ticketId === report.ticketId);
      const quickActions = report.quickActions && report.quickActions.length > 0 ? { quickActions: report.quickActions } : {};
      if (index < 0) {
        return appendCapped(prev, { key: nextMessageKey(), ticketId: report.ticketId, speaker: "pet", text: report.text, ...quickActions });
      }
      const existing = prev[index]!;
      if (!existing.streaming) return prev; // 已定稿的重复 ready 不动
      const next = [...prev];
      next[index] = { ...existing, text: report.text, streaming: undefined, ...quickActions };
      return next;
    });
    if (report.emotion) setChatEmotion(report.emotion); // 结束后按表情标签切表情(工单 12)
    setAwaitingReply(false);
    if (!chatOpenRef.current) setChatDot(true);
  }

  function clearChat() {
    setMessages([]);
    setChatDot(false);
  }

  /** 指令出口:面板芯片、待办按钮共用。发送失败不上气泡,由账本/后续待办兜底。 */
  function sendCommandNow(text: string) {
    void agent.sendCommand(text).catch(() => undefined);
  }

  /** 快捷芯片与回复建议(工单 11→12):回话照发、跳转照跳,点完收起面板。 */
  function runQuickAction(label: string) {
    sendCommandNow(label);
    onQuickAction?.(label as QuickRingAction); // 建议文案即快捷芯片文案(服务端意图表同一份)
    closeChat();
  }

  /** 拖放出口(工单 07):每个文件一张 dropped 触发,只带文件名与类型,demo 不读内容、不上传。 */
  function sendDroppedFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      void agent
        .sendTrigger({
          source: "materials",
          kind: "dropped",
          data: { fileName: file.name, fileKind: inferFileKind(file) },
        })
        .catch(() => undefined);
    }
  }

  /** 批注出口(工单 07):待审卡上的批注唤醒原工单按批注改草稿;空批注不发。 */
  function submitNote(ticketId: string) {
    const note = (notes[ticketId] ?? "").trim();
    if (!note) return;
    void agent.sendTrigger({ source: "pet", kind: "annotate", data: { ticketId, note } }).catch(() => undefined);
    setNotes((prev) => ({ ...prev, [ticketId]: "" }));
  }

  /** 放权模式出口(工单 08):切换以服务端返回为准,失败保持原样不打扰。 */
  function switchAcceptMode(mode: AcceptMode) {
    agent
      .setAcceptMode(mode)
      .then((next) => {
        setPolicy(next);
        return agent.evals();
      })
      .then((next) => setEvals(next))
      .catch(() => undefined);
  }

  /** 戳一下(工单 12):固定台词轮换 + 切表情,不调模型;台词即气泡(≤40 字)。 */
  function poke() {
    wake();
    const line = pokeLine(pokeCount);
    setPokeCount((count) => count + 1);
    setBubble(clampBubble(line.text));
    setPokeExpression(line.expression);
    if (pokeTimerRef.current !== null) window.clearTimeout(pokeTimerRef.current);
    pokeTimerRef.current = window.setTimeout(() => setPokeExpression(null), REACTION_HOLD_MS);
  }

  // Ctrl+K 全局唤出对话面板(工单 12,与单击头像同一个面板)。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        chatOpenRef.current = true;
        setChatOpen(true);
        setChatDot(false);
        setSleepy(false);
        setActivityAt(Date.now());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 工单视图底座(工单 05):进场先拉一次只读账本视图;失败静默,SSE 仍会驱动。
  useEffect(() => {
    let alive = true;
    agent
      .tickets()
      .then((next) => {
        if (alive) setTickets(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [agent]);

  // 订阅 agent 事件流:report 原位刷新工单视图(待审顺带晃一下角标),
  // delta 逐字进对话,pet-bubble 出气泡(超长兜底截 40 字;面板开着不弹)。
  useEffect(() => {
    return agent.onEvent((event) => {
      if (event.type === "report") {
        setTickets((prev) => upsertTicket(prev, event.report));
        if (event.report.status === "waiting" || event.report.status === "blocked") {
          setTodoShake((count) => count + 1); // 收到待审:角标晃一下(工单 12)
        }
        // 有新汇报就可能伴随新的评估记录(工单 08),顺手刷新,面板开着就能看到。
        agent.evals().then(setEvals).catch(() => undefined);
        applyChatReport(event.report);
      } else if (event.type === "channel" && event.channel.target === "pet-bubble") {
        // 面板开着时回复就在面板里看,不再弹气泡;关着才出气泡(工单 12)。
        if (!chatOpenRef.current) setBubble(clampBubble(event.channel.text));
      } else if (event.type === "delta") {
        applyDelta(event.ticketId, event.text);
      }
    });
  }, [agent]);

  // 待办面板打开时拉取放权模式与评估记录(工单 08);演示经 focusPanel 强开时同样要拉
  // (工单 10 第⑦幕直接展示放权开关与评估记录)。失败静默,开关与列表先给空态。
  useEffect(() => {
    if (!inboxOpen && focusPanel !== "inbox") return;
    let alive = true;
    agent
      .policy()
      .then((next) => {
        if (alive) setPolicy(next);
      })
      .catch(() => undefined);
    agent
      .evals()
      .then((next) => {
        if (alive) setEvals(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [agent, inboxOpen, focusPanel]);

  // 对话历史落本地(工单 12):只存最近 50 条,流式标记不落。
  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHAT_KEY,
        JSON.stringify(
          messages.slice(-CHAT_HISTORY_MAX).map(({ speaker, text, quickActions }) => ({
            speaker,
            text,
            ...(quickActions && quickActions.length > 0 ? { quickActions } : {}),
          })),
        ),
      );
    } catch {
      // 隐私模式写不进就算了,本次会话内对话仍可用。
    }
  }, [messages]);

  // 事件反应(工单 12):换表情并停一下就还回去;待审不换表情(只晃角标)。
  useEffect(() => {
    if (!reaction) return;
    const next = reactionExpression(reaction);
    if (next) setReactionExpr(next);
    const timer = window.setTimeout(() => setReactionExpr(null), REACTION_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  // 面板彻底关上(用户关的或演示焦点挪走)时,把对话表情还给正常神态。
  useEffect(() => {
    if (!chatOpen && focusPanel !== "chat") setChatEmotion(null);
  }, [chatOpen, focusPanel]);

  // 闲置入睡(工单 12):3 分钟没动静变 sleepy,再点一下醒来(只是表情,不推送)。
  useEffect(() => {
    const timer = window.setTimeout(() => setSleepy(true), IDLE_SLEEP_MS);
    return () => window.clearTimeout(timer);
  }, [activityAt]);

  // 演示代发对话(工单 12):如同玩家亲手输入;nonce 去重,StrictMode 重放也不重发。
  useEffect(() => {
    if (!demoChatCue || demoChatCue.nonce === demoChatSentRef.current) return;
    demoChatSentRef.current = demoChatCue.nonce;
    chatOpenRef.current = true;
    setChatOpen(true);
    setChatDot(false);
    wake();
    sendChat(demoChatCue.text);
    onDemoChatDone?.();
    // 依赖按约定逐字面列出(见 PetDemoConsole 同款):cue 变更才执行。
  }, [demoChatCue]);

  useEffect(() => {
    return () => {
      if (pokeTimerRef.current !== null) window.clearTimeout(pokeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const base = dragRef.current;
      if (!base) return;
      draggedRef.current = true;
      const next = { left: base.baseLeft + (e.clientX - base.startX), top: base.baseTop + (e.clientY - base.startY) };
      // 重定基线:onUp 时基线就是最新位置,直接落盘。
      dragRef.current = { startX: e.clientX, startY: e.clientY, baseLeft: next.left, baseTop: next.top };
      setPos(next);
    }
    function onUp() {
      setDragging(false);
      const root = rootRef.current;
      const base = dragRef.current;
      if (root && base) savePos({ left: base.baseLeft, top: base.baseTop });
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    const root = rootRef.current;
    if (!root) return;
    wake(); // 摸它一下也算活动(工单 12)
    const rect = root.getBoundingClientRect();
    draggedRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: pos?.left ?? rect.left,
      baseTop: pos?.top ?? rect.top,
    };
    setDragging(true);
  }

  /** 单击头像(工单 12):优先进入对话;拖完松手的补偿 click 不算。 */
  function onAvatarClick() {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (chatOpenRef.current) closeChat();
    else openChat();
  }

  // 有效表情(工单 12 互动感):被拎起来 > 睡着 > 戳一下 > 对话情绪 > 事件反应 > 外部神态。
  const shownExpression: PetExpression = dragging
    ? "pout"
    : sleepy
      ? "sleepy"
      : (pokeExpression ?? chatEmotion ?? reactionExpr ?? expression);

  // 待人决定与受阻的工单(spec 故事 11/16):角标数量、待办面板都由它驱动。
  // 受阻卡(Watchdog 标的)只说明原因;同意/驳回与批注只属于等待中的待审卡。
  const todoTickets = tickets.filter((ticket) => ticket.status === "waiting" || ticket.status === "blocked");

  // 头顶角标:待办数(等待+受阻),点击开关待办面板;数量或待审节拍变化时重挂载,
  // 重放「晃一下」动画(工单 12:收到待审晃一下);勿扰时不打扰。
  const badge =
    todoTickets.length > 0 && !dnd ? (
      <button
        type="button"
        className="desk-pet-badge"
        key={`badge-${todoTickets.length}-${todoShake}`}
        aria-label={`待办 ${todoTickets.length}`}
        onClick={(e) => {
          e.stopPropagation(); // 点角标只开关待办面板,不触发头像的对话面板
          setInboxOpen((open) => !open);
        }}
      >
        {todoTickets.length}
      </button>
    ) : null;

  // 待办面板:顶部放权模式三段开关与评估记录(工单 08,spec 故事 14),
  // 下面列出等待工单,「同意」「驳回」把决定作为 Trigger 发回 Router(spec 故事 11);
  // 待审卡可写批注唤醒原工单(工单 07,spec 故事 13)。
  const inbox =
    (inboxOpen || focusPanel === "inbox") && !dnd ? (
      <div className="desk-pet-inbox" role="region" aria-label="待办面板">
        <div className="desk-pet-policy" role="group" aria-label="放权模式">
          <span className="desk-pet-policy-label">放权模式</span>
          <div className="desk-pet-policy-switch">
            {ACCEPT_MODE_OPTIONS.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                aria-pressed={policy?.acceptMode === mode ? "true" : "false"}
                onClick={() => switchAcceptMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {todoTickets.length === 0 && <p className="desk-pet-inbox-empty">没有等你拍板的事</p>}
        {todoTickets.map((ticket) =>
          ticket.status === "blocked" ? (
            <div className="desk-pet-inbox-item" key={ticket.ticketId}>
              <p className="desk-pet-inbox-text">
                <span className="desk-pet-status" data-status="blocked">
                  {STATUS_LABEL.blocked}
                </span>
                {ticket.text || NO_REPORT_TEXT}
              </p>
            </div>
          ) : (
            <div className="desk-pet-inbox-item" key={ticket.ticketId}>
              <p className="desk-pet-inbox-text">{ticket.text || NO_REPORT_TEXT}</p>
            <div className="desk-pet-inbox-actions">
              <button type="button" onClick={() => sendCommandNow(`同意 ${ticket.ticketId}`)}>
                同意
              </button>
              <button type="button" onClick={() => sendCommandNow(`驳回 ${ticket.ticketId}`)}>
                驳回
              </button>
            </div>
            <form
              className="desk-pet-note"
              onSubmit={(e) => {
                e.preventDefault();
                submitNote(ticket.ticketId);
              }}
            >
              <input
                className="desk-pet-note-input"
                aria-label="批注"
                placeholder="写句批注，让草稿再改一版"
                value={notes[ticket.ticketId] ?? ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [ticket.ticketId]: e.target.value }))}
              />
              <button type="submit">发批注</button>
            </form>
          </div>
          ),
        )}
        <div className="desk-pet-evals" role="region" aria-label="评估记录">
          <p className="desk-pet-evals-title">评估记录</p>
          {evals.length === 0 && <p className="desk-pet-eval">还没有评估记录</p>}
          {evals.map((record) => (
            <p className="desk-pet-eval" key={`${record.triggerId}-${record.ruleId}`}>
              <span className="desk-pet-eval-meta">
                {formatEvalTime(record.at)} · {record.ruleId} · {EVAL_OUTCOME_LABEL[record.outcome]}
              </span>
              <br />
              {record.wouldDo}——{record.why}
            </p>
          ))}
        </div>
      </div>
    ) : null;

  // 工单列表:桌宠旁展开,每张工单带状态徽标(spec 故事 10)。
  const ticketList =
    (listOpen || focusPanel === "tickets") && !dnd ? (
      <div className="desk-pet-tickets" role="region" aria-label="工单列表">
        {tickets.length === 0 && <p className="desk-pet-ticket">还没有工单</p>}
        {tickets.map((ticket) => (
          <p className="desk-pet-ticket" key={ticket.ticketId}>
            <span className="desk-pet-status" data-status={ticket.status}>
              {STATUS_LABEL[ticket.status]}
            </span>
            {ticket.text || NO_REPORT_TEXT}
          </p>
        ))}
      </div>
    ) : null;

  // 对话面板(工单 12):单击头像/Ctrl+K/演示焦点都能打开。
  const chatPanel =
    (chatOpen || focusPanel === "chat") && !dnd ? (
      <PetChatPanel
        messages={messages}
        awaitingReply={awaitingReply}
        inCall={inCall}
        onSend={sendChat}
        onClose={closeChat}
        onClear={clearChat}
        onQuickAction={runQuickAction}
        onOpenDemo={() => {
          onOpenDemo?.();
          closeChat(); // 舞台交给演示控制条
        }}
      />
    ) : null;

  // 头顶悬浮栈:气泡在上、待办/工单居中、对话面板贴身,避免浮层互相遮挡。
  const popovers = (
    <div className="desk-pet-popovers">
      {dropHover && !dnd && <p className="desk-pet-drop-hint">交给我</p>}
      {bubble !== null && !dnd && (
        <p className="desk-pet-bubble" role="status" aria-label="桌宠气泡">
          {bubble}
        </p>
      )}
      {inbox}
      {ticketList}
      {chatPanel}
    </div>
  );

  const anchored = pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : undefined;

  function switchVariant() {
    const next: PetVariant = variant === "f" ? "m" : "f";
    setVariant(next);
    try {
      window.localStorage.setItem(VARIANT_KEY, next);
    } catch {
      // 隐私模式写不进就算了,本次会话内切换仍生效。
    }
  }

  if (dnd) {
    return (
      <aside
        ref={rootRef}
        className="desk-pet desk-pet-collapsed"
        aria-label="桌宠"
        data-variant={variant}
        data-dnd="true"
        style={anchored}
      >
        <button
          type="button"
          className="desk-pet-restore"
          aria-label="桌宠勿扰中,点击恢复"
          onClick={() => {
            setDnd(false);
            wake();
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
      data-dragging={dragging || undefined}
      data-drop-hover={dropHover || undefined}
      data-reduced-motion={reducedMotion() || undefined}
      style={anchored}
      onPointerDown={onPointerDown}
      onDragOver={(e) => {
        e.preventDefault(); // 允许松手
        setDropHover(true);
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropHover(false);
        sendDroppedFiles(e.dataTransfer?.files ?? []);
      }}
    >
      <div className="desk-pet-avatar" onClick={onAvatarClick} onDoubleClick={poke}>
        <img
          src={petImg[variant][shownExpression]}
          alt={`桌宠·${variantLabel[variant]}·${expressionLabel[shownExpression]}`}
          draggable={false}
        />
        {badge}
        {chatDot && <span className="desk-pet-dot" aria-label="有新回复" />}
      </div>
      {popovers}
      <div className="desk-pet-actions">
        <button type="button" className="desk-pet-action" onClick={switchVariant}>
          切换{variant === "f" ? "男版" : "女版"}
        </button>
        <button
          type="button"
          className="desk-pet-action"
          aria-expanded={inboxOpen || undefined}
          onClick={() => setInboxOpen((open) => !open)}
        >
          待办
        </button>
        <button
          type="button"
          className="desk-pet-action"
          aria-expanded={listOpen || undefined}
          onClick={() => setListOpen((open) => !open)}
        >
          工单
        </button>
        <button type="button" className="desk-pet-action" onClick={() => setDnd(true)}>
          勿扰
        </button>
      </div>
    </aside>
  );
}
