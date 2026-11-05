import { useEffect, useRef, useState } from "react";
import type { AgentClient } from "./agent-client";
import type { AgentEvent, AgentReport, ChatContext, PetEmotion } from "../shared/agent-contract";
import { CHAT_KEY, loadChatHistory, serializeChat, type PetChatMessage } from "./chat-history";
import { appendCapped, applyChatReport as reportToMessages, mergeDelta } from "./chat-stream";
import { DEMO_COMMAND, type QuickRingAction } from "./pet-reactions";

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
  onOpenDemo,
}: {
  agent: AgentClient;
  /** 当前页面名:进对话上下文,桌宠回话结合所在页。 */
  view?: string;
  /** 牌局快照(工单 16):随 chat 触发附带给桌宠 Worker;不在牌局时为 idle 快照或 null。 */
  chatContext?: ChatContext | null;
  /** 对话输入「演示」时唤出一键演示(工单 15:分流在上层,面板不识别命令词)。 */
  onOpenDemo?: () => void;
}) {
  const [messages, setMessages] = useState<PetChatMessage[]>(loadSessionChat);
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
  function send(text: string, quickAction?: QuickRingAction): void {
    if (text === DEMO_COMMAND) {
      onOpenDemo?.();
      return;
    }
    if (quickAction) {
      void agent.sendCommand(quickAction).catch(() => undefined);
      return;
    }
    const noteFor = annotating;
    if (noteFor) {
      // 引用态:这句话是给待拍板卡的批注(工单 15,批注表单已删)。
      setAnnotating(null);
      setMessages((prev) => appendCapped(prev, { key: nextMessageKey(), speaker: "player", text }));
      void agent
        .sendTrigger({ source: "pet", kind: "annotate", data: { ticketId: noteFor, note: text } })
        .catch(() => undefined);
      return;
    }
    setChatEmotion("think"); // 回复期间表情切 think(工单 12)
    pendingRef.current += 1;
    setPending(pendingRef.current);
    const history = messages
      .filter((message) => !message.streaming)
      .slice(-CHAT_HISTORY_MESSAGES)
      .map(({ speaker, text: messageText }) => ({ speaker, text: messageText }));
    setMessages((prev) => appendCapped(prev, { key: nextMessageKey(), speaker: "player", text }));
    agent
      .sendTrigger({
        source: "pet",
        kind: "chat",
        data: { text, history, ...(view ? { view } : {}), ...(chatContext ? { context: chatContext } : {}) },
      })
      .then((outcome) => {
        // 回执先登记(审查 S1):回执自带的最终 Report 直接落消息,不依赖 SSE。
        if (outcome.ticket) chatTicketsRef.current.add(outcome.ticket.id);
        if (outcome.report) {
          setMessages((prev) => reportToMessages(prev, outcome.report!, nextMessageKey));
          if (outcome.ticket) settle(outcome.ticket.id, outcome.report);
        } else if (outcome.ticket) {
          chatTicketsRef.current.add(outcome.ticket.id);
        } else {
          // 没立上工单(未准入):别让「…」挂着。
          pendingRef.current = Math.max(0, pendingRef.current - 1);
          setPending(pendingRef.current);
          if (pendingRef.current === 0) setChatEmotion(null);
        }
      })
      .catch(() => {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        setPending(pendingRef.current);
        if (pendingRef.current === 0) setChatEmotion(null);
        setMessages((prev) =>
          appendCapped(prev, { key: nextMessageKey(), speaker: "pet", text: "网络不顺，刚那句没发出去，再说一遍？" }),
        );
      });
  }

  /** SSE 事件里的对话部分:delta 拼接、终态 Report 落消息(非对话工单不管)。 */
  function applyEvent(event: AgentEvent): void {
    if (event.type === "delta") {
      chatTicketsRef.current.add(event.ticketId);
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
    setMessages([]);
    setChatDot(false);
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
    messages,
    awaitingReply: pending > 0,
    chatEmotion,
    chatDot,
    annotating,
    send,
    sendQuickAction: (action: QuickRingAction) => send(action, action),
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

/** 读盘包 try(存储被禁用不崩,审查 R10),校验截断在纯模块。 */
function loadSessionChat(): PetChatMessage[] {
  try {
    return loadChatHistory(window.localStorage.getItem(CHAT_KEY));
  } catch {
    return [];
  }
}
