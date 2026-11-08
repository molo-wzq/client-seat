import { useEffect, useRef, useState } from "react";
import type { AgentClient } from "./agent-client";
import type { AgentEvent, AgentReport, ChatContext, PetEmotion, XiaobeiMessage } from "../shared/agent-contract";
import { CHAT_KEY, loadChatHistory, serializeChat, type PetChatMessage } from "./chat-history";
import { appendCapped, applyChatReport as reportToMessages, mergeDelta } from "./chat-stream";
import { DEMO_COMMAND, type QuickRingAction } from "./pet-reactions";
import { BOT_NOTES_KEY, BOT_NOTES_LIMIT, loadBotNotes } from "./bot-notes";

const SESSION_KEY = "xiaobei-session-id";

/** 进模型的对话历史轮数(spec:history 最近 N 轮;一轮 = 玩家 + 桌宠各一句)。 */
const CHAT_HISTORY_MESSAGES = 16;

/**
 * 对话状态机 hook(工单 12 起,工单 15 抽出):消息、流式、等待、情绪、红点、引用批注、
 * 历史持久化都在这里;DeskPet 只管开合与事件路由。
 * - 等待按「已发未终态」计数(审查 S10):两条并发,第一条回来不打断第二条的「…」;
 * - 回执里的最终 Report 也落消息(审查 S1):SSE 断流/正文为空都不丢回复;
 * - failed/dropped 同为终态(审查 S2),消息变迁走 chat-stream 纯模块;
 * - 序列化串没变不写盘(审查 R1),流式期间不逐字刷 localStorage。
 */
export function useChatSession({
  agent,
  view,
  chatContext,
  gameId,
  onOpenDemo,
  onPetReply,
}: {
  agent: AgentClient;
  /** 当前页面名:进对话上下文,桌宠回话结合所在页。 */
  view?: string;
  /** 牌局快照(工单 16):随 chat 触发附带给桌宠 Worker;不在牌局时为 idle 快照或 null。 */
  chatContext?: ChatContext | null;
  gameId?: string;
  /** 对话输入「演示」时唤出一键演示(工单 15:分流在上层,面板不识别命令词)。 */
  onOpenDemo?: () => void;
  /** 小贝这句说完:面板关着、又不在通话里时,用来出 40 字气泡。 */
  onPetReply?: (message: XiaobeiMessage) => void;
}) {
  const [messages, setMessages] = useState<PetChatMessage[]>(loadSessionChat);
  const [notes, setNotes] = useState(loadBotNotes);
  const [activeSteps, setActiveSteps] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const nextRun = useRef(0);
  const [pending, setPending] = useState(0);
  /** 等待数与状态同源(settle 里要读「结算后还剩几个」来决定要不要还原表情)。 */
  const pendingRef = useRef(0);
  const [chatEmotion, setChatEmotion] = useState<PetEmotion | null>(null);
  const [chatDot, setChatDot] = useState(false);
  /** 引用态(工单 15):正在给这张待拍板卡写批注,发的话就是批注。 */
  const [annotating, setAnnotating] = useState<string | null>(null);
  /** 已认定的对话工单号:发送回执与 delta 都会登记,Report 据此路由进对话。 */
  const chatTicketsRef = useRef<Set<string>>(new Set());
  /** 已终态的对话工单号:回执与 SSE 双路到达只结算一次。 */
  const settledRef = useRef<Set<string>>(new Set());
  /** 面板此刻可见:红点据此让位(用户开着或演示焦点)。 */
  const panelVisibleRef = useRef(false);
  const messageKeyRef = useRef(0);
  /** 上次写盘的串(R1):相同就不写。 */
  const lastSavedRef = useRef<string | null>(null);
  const sessionIdRef = useRef(loadSessionId());

  function nextMessageKey(): string {
    messageKeyRef.current += 1;
    return `m${messageKeyRef.current}`;
  }

  /**
   * 终态结算(审查 S2):等待计数按工单只清一次;表情跟着最新终态走——
   * ready 带标签就切,没有(或 failed/dropped 后没有更新的 ready)且不剩等待就还原。
   * 回退路径同一工单先 failed 再 ready,第二次结算仍应用 ready 的表情。
   */
  function settle(ticketId: string, report?: AgentReport): void {
    if (!settledRef.current.has(ticketId)) {
      settledRef.current.add(ticketId);
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      setPending(pendingRef.current);
    }
    if (report?.status === "ready" && report.emotion) setChatEmotion(report.emotion);
    else if (pendingRef.current === 0) setChatEmotion(null);
    if (!panelVisibleRef.current) setChatDot(true);
  }

  /** 面板 onSubmit 的唯一出口(工单 15):「演示」分流、引用态走批注、其余走对话。 */
  function send(text: string): void {
    if (text === DEMO_COMMAND) {
      onOpenDemo?.();
      return;
    }
    const noteFor = annotating;
    if (noteFor) setAnnotating(null);
    setChatEmotion("think"); // 回复期间表情切 think(工单 12)
    pendingRef.current += 1;
    setPending(pendingRef.current);
    const history = messages
      .filter((message) => !message.streaming)
      .slice(-CHAT_HISTORY_MESSAGES)
      .map(({ speaker, text: messageText }) => ({ speaker, text: messageText }));
    setMessages((prev) => appendCapped(prev, { key: nextMessageKey(), speaker: "player", text }));
    const runId = `xb-${++nextRun.current}`;
    const version = generation.current;
    let readyReport: AgentReport | undefined;
    let streamed = false;
    void agent.sendChat({
      sessionId: sessionIdRef.current,
      text,
      history: history.map((message) => ({ speaker: message.speaker, body: message.text })),
      notes,
      ...(gameId ? { gameId } : {}),
      ...(view ? { view } : {}),
      ...(chatContext ? { context: chatContext } : {}),
      ...(noteFor ? { annotateTicketId: noteFor } : {}),
    }, (event) => {
      if (version !== generation.current) return;
      if (event.type === "step") {
        setActiveSteps((prev) => ({ ...prev, [runId]: event.text }));
      } else if (event.type === "delta") {
        streamed = true;
        setMessages((prev) => mergeDelta(prev, runId, event.text, nextMessageKey));
      } else if (event.type === "done") {
        const message = event.message;
        const report: AgentReport = {
          ticketId: runId,
          status: "ready",
          text: message.body,
          ...(message.emotion ? { emotion: message.emotion } : {}),
        };
        setMessages((prev) => reportToMessages(prev, report, nextMessageKey).map((item) =>
          item.ticketId === runId
            ? {
                ...item,
                ticketId: message.ticketId,
                emotion: message.emotion,
                bot: { evidence: message.evidence ?? [], steps: message.steps ?? [] },
              }
            : item,
        ));
        if (message.ticketId) chatTicketsRef.current.add(message.ticketId);
        readyReport = report;
        onPetReply?.(message);
      }
    }).catch(() => {
      if (version !== generation.current) return;
      const failed: AgentReport = {
        ticketId: runId,
        status: "failed",
        text: streamed ? "刚才的回复中断了。你可以再发一次。" : "网络不顺，刚那句没发出去，再说一遍？",
      };
      readyReport = failed;
      setMessages((prev) => reportToMessages(prev, failed, nextMessageKey));
    }).finally(() => {
      if (version !== generation.current) return;
      setActiveSteps((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      settle(runId, readyReport);
    });
  }

  /** SSE 事件里的对话部分:delta 拼接、终态 Report 落消息(非对话工单不管)。 */
  function applyEvent(event: AgentEvent): void {
    // 玩家的话不再从触发流里长出来。这里只接已经跟踪的工单后续汇报。
    if (event.type === "delta") {
      if (!chatTicketsRef.current.has(event.ticketId)) return;
      setMessages((prev) => mergeDelta(prev, event.ticketId, event.text, nextMessageKey));
      if (!panelVisibleRef.current) setChatDot(true);
      return;
    }
    if (event.type !== "report") return;
    const report = event.report;
    if (!chatTicketsRef.current.has(report.ticketId)) return;
    if (report.status !== "ready" && report.status !== "failed" && report.status !== "dropped") return;
    setMessages((prev) => reportToMessages(prev, report, nextMessageKey));
    settle(report.ticketId, report);
  }

  /** 拖入的文件进对话(工单 15):一个文件一条附件消息,与 dropped 触发并行。 */
  function attachFiles(names: string[]): void {
    if (names.length === 0) return;
    setMessages((prev) => {
      let next = prev;
      for (const name of names) {
        next = appendCapped(next, { key: nextMessageKey(), speaker: "player", text: `📎 ${name}` });
      }
      return next;
    });
  }

  /** 面板开合同步(用户或演示):打开清红点。 */
  function markVisible(open: boolean): void {
    panelVisibleRef.current = open;
    if (open) setChatDot(false);
  }

  /** 面板收起:对话情绪还给正常神态。 */
  function resetEmotion(): void {
    setChatEmotion(null);
  }

  /** 待拍板卡「改一改」:进入引用态;再点同一张取消。 */
  function quote(ticketId: string): void {
    setAnnotating((current) => (current === ticketId ? null : ticketId));
  }

  function cancelQuote(): void {
    setAnnotating(null);
  }

  function clearHistory(): void {
    generation.current += 1;
    pendingRef.current = 0;
    setPending(0);
    setChatEmotion(null);
    setActiveSteps({});
    setMessages([]);
    setChatDot(false);
  }

  function saveNote(message: PetChatMessage): boolean {
    if (!message.bot || !message.text.trim()) return false;
    if (notes.some((note) => note.text === message.text)) return true;
    const next = [...notes, {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${nextMessageKey()}`,
      text: message.text.slice(0, 4800),
      evidence: message.bot.evidence,
    }].slice(-BOT_NOTES_LIMIT);
    try {
      window.localStorage.setItem(BOT_NOTES_KEY, JSON.stringify(next));
      setNotes(next);
      return true;
    } catch {
      return false;
    }
  }

  function deleteNote(id: string): void {
    const next = notes.filter((note) => note.id !== id);
    try {
      window.localStorage.setItem(BOT_NOTES_KEY, JSON.stringify(next));
      setNotes(next);
    } catch {
      // Keep the visible notebook consistent with the saved copy.
    }
  }

  // 对话历史落本地:序列化在纯模块,串没变不重复写盘(审查 R1)。
  useEffect(() => {
    try {
      const payload = serializeChat(messages);
      if (payload === lastSavedRef.current) return;
      lastSavedRef.current = payload;
      window.localStorage.setItem(CHAT_KEY, payload);
    } catch {
      // 隐私模式写不进就算了,本次会话内对话仍可用。
    }
  }, [messages]);

  return {
    sessionId: sessionIdRef.current,
    messages,
    notes,
    saveNote,
    deleteNote,
    activeStep: Object.values(activeSteps).at(-1),
    awaitingReply: pending > 0,
    chatEmotion,
    chatDot,
    annotating,
    send,
    sendQuickAction: (action: QuickRingAction) => send(action),
    attachFiles,
    applyEvent,
    /** 这张工单是否本面板的对话工单(工单 16):非对话工单的表情由桌宠直接表达。 */
    ownsTicket: (ticketId: string) => chatTicketsRef.current.has(ticketId),
    markVisible,
    resetEmotion,
    quote,
    cancelQuote,
    clearHistory,
  };
}

/** 同一段小贝会话的稳定 id。清空消息也不换 id。 */
function loadSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = globalThis.crypto?.randomUUID?.() ?? `xiaobei-${Date.now()}`;
    window.localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "xiaobei-local";
  }
}

/** 读盘包 try(存储被禁用不崩,审查 R10),校验截断在纯模块。 */
function loadSessionChat(): PetChatMessage[] {
  try {
    return loadChatHistory(window.localStorage.getItem(CHAT_KEY));
  } catch {
    return [];
  }
}
