import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DEMO_COMMAND, QUICK_RING } from "./pet-reactions";

/**
 * 对话面板的一条消息(工单 12):ticketId 只在本次会话内有值,
 * 落 localStorage 时只存说话人与正文。streaming 表示正文还在逐字到达。
 */
export interface PetChatMessage {
  key: string;
  /** 关联的对话工单号(pet 回复才有):流式 delta 与最终 Report 按它对上。 */
  ticketId?: string;
  speaker: "player" | "pet";
  text: string;
  streaming?: boolean;
  /** 快捷动作建议(工单 11/12):渲染成按钮,点了才执行。 */
  quickActions?: string[];
}

/**
 * 桌宠对话面板(工单 12,点击优先对话):卡纸底、黄铜描边,
 * 顶部快捷芯片(原快捷环收进来),中间消息记录,底部 Enter 发送的多行输入。
 * 面板只管渲染与输入,消息状态、流式拼接与表情都在 DeskPet。
 * 通话中输入框锁住(spec:提示「通话中，挂断后再聊」,表情反应照常),芯片不锁
 * (快捷环「再来一局」对局中还得能按,工单 03 约定沿用)。
 */
export function PetChatPanel({
  messages,
  awaitingReply,
  inCall,
  onSend,
  onClose,
  onClear,
  onQuickAction,
  onOpenDemo,
}: {
  /** 对话记录(最近 50 条由 DeskPet 截断持久化)。 */
  messages: PetChatMessage[];
  /** 已发出还没见到回音:显示「…」打字指示。 */
  awaitingReply: boolean;
  inCall: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
  onClear: () => void;
  /** 快捷芯片与回复建议共用出口:发命令 + 跳转。 */
  onQuickAction: (label: string) => void;
  onOpenDemo: () => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开即聚焦,直接打字(工单 12:单击头像优先进入对话)。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 新内容到达滚到底部,最新一句始终可见。
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, awaitingReply]);

  function submit() {
    const text = draft.trim();
    if (!text || inCall) return;
    if (text === DEMO_COMMAND) {
      // 「演示」是给汇报人的入口(工单 10),不作为对话发给 Agent。
      onOpenDemo();
      setDraft("");
      return;
    }
    onSend(text);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // Enter 发送,Shift+Enter 留给换行
      submit();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="desk-pet-chat" role="region" aria-label="对话面板">
      <div className="desk-pet-chat-head">
        <span className="desk-pet-chat-title">跟桌宠聊</span>
        <button type="button" className="desk-pet-chat-clear" aria-label="清空对话" onClick={onClear}>
          清空
        </button>
        <button type="button" className="desk-pet-chat-close" aria-label="关闭对话" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="desk-pet-chat-chips" role="group" aria-label="快捷芯片">
        {QUICK_RING.map((label) => (
          <button key={label} type="button" className="desk-pet-chip" onClick={() => onQuickAction(label)}>
            {label}
          </button>
        ))}
      </div>
      <div className="desk-pet-chat-list" ref={listRef} role="log" aria-label="对话记录">
        {messages.length === 0 && !awaitingReply && <p className="desk-pet-chat-empty">点头像或按 Ctrl+K,随时叫我。</p>}
        {messages.map((message) => (
          <div className="desk-pet-chat-msg" data-speaker={message.speaker} key={message.key}>
            <p className="desk-pet-chat-bubble" data-streaming={message.streaming || undefined}>
              {message.text}
            </p>
            {message.quickActions?.map((label) => (
              <button key={label} type="button" className="desk-pet-chat-action" onClick={() => onQuickAction(label)}>
                {label}
              </button>
            ))}
          </div>
        ))}
        {awaitingReply && (
          <div className="desk-pet-chat-msg" data-speaker="pet">
            <p className="desk-pet-chat-bubble desk-pet-typing" aria-label="正在输入">
              …
            </p>
          </div>
        )}
      </div>
      <form
        className="desk-pet-chat-input"
        data-incall={inCall || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          aria-label="对话输入"
          rows={2}
          placeholder={inCall ? "通话中，挂断后再聊" : "跟桌宠说点什么…(Enter 发送)"}
          disabled={inCall}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="desk-pet-chat-input-actions">
          <button type="submit" className="desk-pet-chat-send" disabled={inCall}>
            发送
          </button>
          {/* 按住说话(ASR)本工单只留占位:语音识别后续接入,先不实现。 */}
          <button type="button" className="desk-pet-hold-speak" disabled title="按住说话(语音识别后续接入)">
            按住说话
          </button>
        </div>
      </form>
    </div>
  );
}
