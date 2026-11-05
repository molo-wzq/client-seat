import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { OPENING_SUGGESTIONS } from "./pet-reactions";
import { resolveSlashCommand, slashCandidates } from "./slash-commands";
import type { PetChatMessage } from "./chat-history";
import type { AcceptMode, AgentPolicy, AgentTicketView } from "../shared/agent-contract";
import type { WorkLogItem } from "./agent-trace";
import { AgentStatusBar } from "./AgentStatusBar";
import { WorkLog } from "./WorkLog";
import { PetMenu } from "./PetMenu";
import { TicketCard } from "./TicketCard";
import type { PetVariant } from "./DeskPet";

/** 消息形状迁去纯模块(工单 15),这里转发导出兼容既有引用。 */
export type { PetChatMessage } from "./chat-history";

/**
 * 桌宠唯一面板(工单 15):以对话为主体——顶部 Agent 状态条(两档放权、点开工作日志),
 * 右上「⋯」菜单(切换男女/勿扰/观察档),中间消息流(待拍板卡插进来),底部输入
 * (输「/」弹命令补全,上下选择 Enter 确认;空对话给 2 个开场建议)。
 * 待拍板卡被「改一改」选中时,输入框上方出现引用条,发出的话就是该工单的批注。
 * 面板只管渲染与输入;消息状态、流式拼接与表情在 useChatSession,互动感在 usePetMood。
 * 通话中照样能聊(工单 15:桌宠站客户一侧,消息不进经理上下文)。
 */
export function PetChatPanel({
  messages,
  awaitingReply,
  tickets,
  annotating,
  policy,
  runningCount,
  variant,
  menuOpen,
  logOpen,
  workLog,
  onSend,
  onClose,
  onClear,
  onQuickAction,
  onApprove,
  onReject,
  onRevise,
  onSetMode,
  onToggleMenu,
  onSwitchVariant,
  onDnd,
  onToggleLog,
}: {
  /** 对话记录(最近 50 条由 useChatSession 截断持久化)。 */
  messages: PetChatMessage[];
  /** 已发出还没见到回音:显示「…」打字指示。 */
  awaitingReply: boolean;
  /** waiting/blocked 工单:以待拍板卡/只读卡插进对话流(工单 15)。 */
  tickets: AgentTicketView[];
  /** 引用态的工单号:输入框上方显示引用条,发的话就是批注。 */
  annotating: string | null;
  policy: AgentPolicy | null;
  /** 进行中工单数(状态条「在跑 N 件事」)。 */
  runningCount: number;
  variant: PetVariant;
  menuOpen: boolean;
  logOpen: boolean;
  workLog: WorkLogItem[];
  onSend: (text: string) => void;
  onClose: () => void;
  onClear: () => void;
  /** 快捷芯片与回复建议共用出口:发命令 + 跳转。 */
  onQuickAction: (label: string) => void;
  onApprove: (ticketId: string) => void;
  onReject: (ticketId: string) => void;
  onRevise: (ticketId: string) => void;
  /** 放权出口(两档 off/auto 走状态条,observe 走 ⋯ 菜单)。 */
  onSetMode: (mode: AcceptMode) => void;
  onToggleMenu: () => void;
  onSwitchVariant: () => void;
  onDnd: () => void;
  onToggleLog: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  /** Esc 关掉过补全,继续打字(或重进命令态)再弹出。 */
  const [slashDismissed, setSlashDismissed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** 引用条对应的草稿文案,展示「正在改哪一版」。 */
  const quotingTicket = tickets.find((ticket) => ticket.ticketId === annotating) ?? null;
  /** 命令态候选(工单 15):候选过滤在纯模块;选中项钳制在候选数内。 */
  const slashOptions = slashDismissed ? [] : slashCandidates(draft);
  const activeSlashIndex = Math.min(slashIndex, Math.max(0, slashOptions.length - 1));

  // 打开即聚焦,直接打字(工单 12:单击头像优先进入对话)。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 新内容到达滚到底部,最新一句始终可见。
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, awaitingReply, tickets]);

  /** 确认一个 / 命令:执行对应动作(发命令+跳转),收起补全。 */
  function runSlash(action: Parameters<typeof onQuickAction>[0]): void {
    onQuickAction(action);
    setDraft("");
    setSlashDismissed(false);
    setSlashIndex(0);
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    // 整句恰是某个命令:按命令执行(补全被 Esc 关掉后手输的路也通,工单 15)。
    const command = resolveSlashCommand(text);
    if (command) {
      onQuickAction(command);
    } else {
      onSend(text);
    }
    setDraft("");
  }

  /** Esc 挂在面板根上(审查 S7):焦点在芯片、按钮上也能关;组字期放行给输入法(审查 B2)。 */
  function onRootKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape") return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    onClose();
  }

  /** 输入框的按键:命令态先服务补全(上下/Enter/Esc),其余 Enter 发送、Shift+Enter 换行;组字期放行(审查 B2)。 */
  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (slashOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault(); // 光标不动,只挪选中项
        setSlashIndex((activeSlashIndex + 1) % slashOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((activeSlashIndex - 1 + slashOptions.length) % slashOptions.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault(); // Enter 确认候选,不当消息发送
        runSlash(slashOptions[activeSlashIndex]!.action);
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation(); // 只关补全,不冒泡给面板根(面板还开着)
        setSlashDismissed(true);
        return;
      }
      return; // 其余按键照常输入
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // Enter 发送,Shift+Enter 留给换行
      submit();
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 对话面板要能 Esc 收起(审查 S7)
    <div className="desk-pet-chat" role="region" aria-label="对话面板" onKeyDown={onRootKeyDown}>
      <div className="desk-pet-chat-head">
        <span className="desk-pet-chat-title">跟桌宠聊</span>
        <button
          type="button"
          className="desk-pet-chat-menu-toggle"
          aria-label="更多设置"
          aria-expanded={menuOpen || undefined}
          onClick={onToggleMenu}
        >
          ⋯
        </button>
        <button type="button" className="desk-pet-chat-clear" aria-label="清空对话" onClick={onClear}>
          清空
        </button>
        <button type="button" className="desk-pet-chat-close" aria-label="关闭对话" onClick={onClose}>
          ×
        </button>
      </div>
      {menuOpen && (
        <PetMenu
          variant={variant}
          policy={policy}
          onSwitchVariant={onSwitchVariant}
          onDnd={onDnd}
          onSetMode={onSetMode}
        />
      )}
      <AgentStatusBar
        awaitingReply={awaitingReply}
        runningCount={runningCount}
        policy={policy}
        onSetMode={onSetMode}
        onToggleLog={onToggleLog}
        logOpen={logOpen}
      />
      {logOpen && <WorkLog items={workLog} />}
      <div className="desk-pet-chat-list" ref={listRef} role="log" aria-label="对话记录">
        {messages.length === 0 && !awaitingReply && tickets.length === 0 && (
          <>
            <p className="desk-pet-chat-empty">点头像或按 Ctrl+K,随时叫我。</p>
            {/* 空对话的 2 个开场建议(工单 15):点了作为一句话发出;之后只剩模型本轮建议动作。 */}
            <div className="desk-pet-chat-chips" role="group" aria-label="开场建议">
              {OPENING_SUGGESTIONS.map((text) => (
                <button key={text} type="button" className="desk-pet-chip" onClick={() => onSend(text)}>
                  {text}
                </button>
              ))}
            </div>
          </>
        )}
        {messages.map((message) => (
          <div className="desk-pet-chat-msg" data-speaker={message.speaker} key={message.key}>
            <p className="desk-pet-chat-bubble" data-streaming={message.streaming || undefined} aria-busy={message.streaming || undefined}>
              {message.text}
            </p>
            {message.quickActions?.map((label) => (
              <button key={label} type="button" className="desk-pet-chat-action" onClick={() => onQuickAction(label)}>
                {label}
              </button>
            ))}
          </div>
        ))}
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.ticketId}
            ticket={ticket}
            onApprove={onApprove}
            onReject={onReject}
            onRevise={onRevise}
            quoting={ticket.ticketId === annotating}
          />
        ))}
        {awaitingReply && !messages.some((message) => message.streaming) && (
          <div className="desk-pet-chat-msg" data-speaker="pet">
            <p className="desk-pet-chat-bubble desk-pet-typing" role="status" aria-label="正在输入">
              …
            </p>
          </div>
        )}
      </div>
      {quotingTicket && (
        <div className="desk-pet-quote" role="status">
          <span className="desk-pet-quote-label">批注</span>
          <span className="desk-pet-quote-text">{quotingTicket.text || "这张待拍板的草稿"}</span>
          <button type="button" aria-label="取消批注" onClick={() => onRevise(quotingTicket.ticketId)}>
            ×
          </button>
        </div>
      )}
      {slashOptions.length > 0 && (
        <div className="desk-pet-slash" role="listbox" aria-label="命令补全">
          {slashOptions.map((item, index) => (
            <button
              key={item.command}
              type="button"
              role="option"
              aria-selected={index === activeSlashIndex || undefined}
              onClick={() => runSlash(item.action)}
            >
              {item.command}
            </button>
          ))}
        </div>
      )}
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
          placeholder={quotingTicket ? "说一句,这条工单就按它改" : "跟桌宠说点什么…(Enter 发送)"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSlashDismissed(false); // 重新打字:补全跟着回来
          }}
          onKeyDown={onInputKeyDown}
        />
        <div className="desk-pet-chat-input-actions">
          <button type="submit" className="desk-pet-chat-send">
            {quotingTicket ? "发批注" : "发送"}
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
