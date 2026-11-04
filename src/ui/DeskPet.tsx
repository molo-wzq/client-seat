import { useEffect, useRef, useState, type RefObject } from "react";
import { reducedMotion } from "./game-feel";
import { createAgentClient, type AgentClient } from "./agent-client";
import type { AgentReport, AgentTicketView, ReportStatus } from "../../server/agent/types";
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

type PetPos = { left: number; top: number };

const VARIANT_KEY = "desk-pet-variant";
const POS_KEY = "desk-pet-pos";

/** 快捷环 4 项(spec 故事 8):文案即命令文本,服务端 DemoWorker 按同一文案回脚本。 */
const QUICK_RING: readonly string[] = ["换个客户", "再来一局", "上局复盘", "本周投研"];

/** 桌宠气泡硬上限 40 字(spec):服务端已截一道,前端展示再兜底。 */
function clampBubble(text: string): string {
  return [...text].slice(0, 40).join("");
}

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
 * 桌宠在牌桌一角陪客户看局(工单 01 外壳 + 工单 03 交互):
 * 点头像出快捷环,Ctrl+K 唤命令条,agent 事件驱动气泡;不说话评价玩家。
 * inCall(对局中)只置灰命令条——快捷环里「再来一局」还得能按。
 */
export function DeskPet({
  expression = "wave",
  inCall = false,
  agent = defaultAgent,
}: {
  expression?: PetExpression;
  inCall?: boolean;
  agent?: AgentClient;
}) {
  const [variant, setVariant] = useState<PetVariant>(
    () => (window.localStorage.getItem(VARIANT_KEY) === "m" ? "m" : "f"),
  );
  const [dnd, setDnd] = useState(false);
  const [pos, setPos] = useState<PetPos | null>(loadPos);
  const [dragging, setDragging] = useState(false);
  const [ringOpen, setRingOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [bubble, setBubble] = useState<string | null>(null);
  const [tickets, setTickets] = useState<AgentTicketView[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  // 拖动基线:按下时的指针与桌宠位置,移动按差值换算,jsdom 里 rect 为 0 也能算对差值。
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  // 按下后是否真的拖动过:拖完松手浏览器仍会补发 click,别让它误开快捷环。
  const draggedRef = useRef(false);

  // Ctrl+K 全局唤出命令条(spec 故事 9)。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBarOpen(true);
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

  // 订阅 agent 事件流:report 原位刷新工单视图,pet-bubble 出气泡(超长兜底截 40 字)。
  useEffect(() => {
    return agent.onEvent((event) => {
      if (event.type === "report") {
        setTickets((prev) => upsertTicket(prev, event.report));
      } else if (event.type === "channel" && event.channel.target === "pet-bubble") {
        setBubble(clampBubble(event.channel.text));
      }
    });
  }, [agent]);

  // 命令条打开即聚焦,直接打字。
  useEffect(() => {
    if (barOpen) commandInputRef.current?.focus();
  }, [barOpen]);

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

  /** 指令出口:命令条与快捷环共用。发送失败不上气泡,由账本/后续待办兜底。 */
  function sendCommandNow(text: string) {
    void agent.sendCommand(text).catch(() => undefined);
  }

  function submitCommand() {
    const text = command.trim();
    if (!text || inCall) return;
    sendCommandNow(text);
    setCommand("");
    setBarOpen(false);
  }

  function closeCommandBar() {
    setCommand("");
    setBarOpen(false);
  }

  const commandBar = barOpen ? (
    <DeskPetCommandBar
      inputRef={commandInputRef}
      inCall={inCall}
      value={command}
      onChange={setCommand}
      onSubmit={submitCommand}
      onClose={closeCommandBar}
    />
  ) : null;

  // 待人决定的工单(spec 故事 11):角标数量、待办面板都由它驱动。
  const waitingTickets = tickets.filter((ticket) => ticket.status === "waiting");

  // 头顶角标:waiting 数,点击开关待办面板;勿扰时不打扰。
  const badge =
    waitingTickets.length > 0 && !dnd ? (
      <button
        type="button"
        className="desk-pet-badge"
        aria-label={`待办 ${waitingTickets.length}`}
        onClick={(e) => {
          e.stopPropagation(); // 点角标只开关待办面板,不触发头像的快捷环
          setInboxOpen((open) => !open);
        }}
      >
        {waitingTickets.length}
      </button>
    ) : null;

  // 待办面板:列出等待工单,「同意」「驳回」把决定作为 Trigger 发回 Router(spec 故事 11)。
  const inbox =
    inboxOpen && !dnd ? (
      <div className="desk-pet-inbox" role="region" aria-label="待办面板">
        {waitingTickets.map((ticket) => (
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
          </div>
        ))}
      </div>
    ) : null;

  // 工单列表:桌宠旁展开,每张工单带状态徽标(spec 故事 10)。
  const ticketList =
    listOpen && !dnd ? (
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

  // 头顶悬浮栈:气泡在上、快捷环居中、命令条贴身,避免浮层互相遮挡。
  const popovers = (
    <div className="desk-pet-popovers">
      {bubble !== null && !dnd && (
        <p className="desk-pet-bubble" role="status" aria-label="桌宠气泡">
          {bubble}
        </p>
      )}
      {inbox}
      {ticketList}
      {ringOpen && !dnd && (
        <div className="desk-pet-ring" aria-label="快捷环">
          {QUICK_RING.map((label) => (
            <button
              key={label}
              type="button"
              className="desk-pet-ring-item"
              onClick={() => {
                sendCommandNow(label);
                setRingOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {commandBar}
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
          onClick={() => setDnd(false)}
        >
          <img src={petImg[variant][expression]} alt="" draggable={false} />
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
      data-expression={expression}
      data-dragging={dragging || undefined}
      data-reduced-motion={reducedMotion() || undefined}
      style={anchored}
      onPointerDown={onPointerDown}
    >
      <div
        className="desk-pet-avatar"
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          setRingOpen((open) => !open);
        }}
      >
        <img
          src={petImg[variant][expression]}
          alt={`桌宠·${variantLabel[variant]}·${expressionLabel[expression]}`}
          draggable={false}
        />
        {badge}
      </div>
      {popovers}
      <div className="desk-pet-actions">
        <button type="button" className="desk-pet-action" onClick={switchVariant}>
          切换{variant === "f" ? "男版" : "女版"}
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

/** 命令条:打字回车发送、Esc 关闭;对局中置灰禁用(工单 03:对局中命令条置灰)。 */
function DeskPetCommandBar({
  inputRef,
  inCall,
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  inCall: boolean;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <form
      className="desk-pet-commandbar"
      data-incall={inCall || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <input
        ref={inputRef}
        className="desk-pet-command-input"
        aria-label="命令条"
        placeholder={inCall ? "对局进行中,先打完这局…" : "跟桌宠说点什么…(Ctrl+K)"}
        value={value}
        disabled={inCall}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* 按住说话(ASR)本工单只留占位:语音识别后续接入,先不实现。 */}
      <button type="button" className="desk-pet-hold-speak" disabled title="按住说话(语音识别后续接入)">
        按住说话
      </button>
    </form>
  );
}
