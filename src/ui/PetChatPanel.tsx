import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DEMO_COMMAND, QUICK_RING } from "./pet-reactions";
import type { PetChatMessage } from "./chat-history";

/** 消息形状迁去纯模块(工单 15),这里转发导出兼容既有引用。 */
export type { PetChatMessage } from "./chat-history";

/**
 * 桌宠对话面板(工单 12 起,工单 15 通话中解锁):卡纸底、黄铜描边,
 * 顶部快捷芯片(原快捷环收进来),中间消息记录,底部 Enter 发送的多行输入。
 * 面板只管渲染与输入,消息状态、流式拼接与表情都在 DeskPet。
 * 桌宠站在客户一侧(工单 15):通话中照样能跟它打字,消息不进经理上下文——
 * 面板不再感知 inCall,出口只有 onSubmit 一条。
 */
export function PetChatPanel({
  messages,
  awaitingReply,
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
    if (!text) return;
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
    // 中文输入法组字期(审查 B2):Chrome 派发 isComposing=true 的 keydown,
    // 老版本以 keyCode 229 标识——一律放行给输入法,回车不发送、Esc 不关面板。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          aria-label="对话输入"
          rows={2}
          placeholder="跟桌宠说点什么…(Enter 发送)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="desk-pet-chat-input-actions">
          <button type="submit" className="desk-pet-chat-send">
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
