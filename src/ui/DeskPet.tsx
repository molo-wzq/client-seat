import { useEffect, useRef, useState, type RefObject } from "react";
import { reducedMotion } from "./game-feel";
import { createAgentClient, type AgentClient } from "./agent-client";
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

type PetPos = { left: number; top: number };

const VARIANT_KEY = "desk-pet-variant";
const POS_KEY = "desk-pet-pos";

/** 快捷环 4 项(spec 故事 8):文案即命令文本,服务端 DemoWorker 按同一文案回脚本。 */
const QUICK_RING: readonly string[] = ["换个客户", "再来一局", "上局复盘", "本周投研"];

/** 快捷环动作(工单 10):回话之外还要跳转,App 按动作决定去哪个视图。 */
export type QuickRingAction = (typeof QUICK_RING)[number];

/** 命令条输入「演示」(工单 10):唤出一键演示控制条,不进 Agent 链路。 */
const DEMO_COMMAND = "演示";

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
 * 工单 07:文件拖到桌宠上高亮「交给我」,松手交 Worker 起草进待审;
 * 待审卡可写批注唤醒原工单。demo 只传文件名与类型,不上传内容。
 * 工单 08:待办面板顶部放权模式三段开关(off/observe/auto)与评估记录列表。
 */
export function DeskPet({
  expression = "wave",
  inCall = false,
  agent = defaultAgent,
  onQuickAction,
  onOpenDemo,
  focusPanel = null,
}: {
  expression?: PetExpression;
  inCall?: boolean;
  agent?: AgentClient;
  /** 快捷环跳转(工单 10):回话照发,App 按动作跳到对应视图。 */
  onQuickAction?: (action: QuickRingAction) => void;
  /** 命令条输入「演示」时唤出一键演示(工单 10);URL ?demo=pet 同效。 */
  onOpenDemo?: () => void;
  /** 演示要看的面板(工单 10):直接展开工单列表/待办面板,演示结束还回去。 */
  focusPanel?: "tickets" | "inbox" | null;
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
  /** 待审卡的批注草稿(工单 07):按工单号各存一份,发送即清空。 */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dropHover, setDropHover] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /** 放权模式与评估记录(工单 08):待办面板打开时拉取,null 表示策略还没到。 */
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [evals, setEvals] = useState<AgentEvalRecord[]>([]);
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
        // 有新汇报就可能伴随新的评估记录(工单 08),顺手刷新,面板开着就能看到。
        agent.evals().then(setEvals).catch(() => undefined);
      } else if (event.type === "channel" && event.channel.target === "pet-bubble") {
        setBubble(clampBubble(event.channel.text));
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

  function submitCommand() {
    const text = command.trim();
    if (!text || inCall) return;
    // 「演示」是给汇报人的入口(工单 10):唤出演示控制条,不作为命令发给 Agent。
    if (text === DEMO_COMMAND) {
      onOpenDemo?.();
      setCommand("");
      setBarOpen(false);
      return;
    }
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

  // 待人决定与受阻的工单(spec 故事 11/16):角标数量、待办面板都由它驱动。
  // 受阻卡(Watchdog 标的)只说明原因;同意/驳回与批注只属于等待中的待审卡。
  const todoTickets = tickets.filter((ticket) => ticket.status === "waiting" || ticket.status === "blocked");

  // 头顶角标:待办数(等待+受阻),点击开关待办面板;勿扰时不打扰。
  const badge =
    todoTickets.length > 0 && !dnd ? (
      <button
        type="button"
        className="desk-pet-badge"
        aria-label={`待办 ${todoTickets.length}`}
        onClick={(e) => {
          e.stopPropagation(); // 点角标只开关待办面板,不触发头像的快捷环
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

  // 头顶悬浮栈:气泡在上、快捷环居中、命令条贴身,避免浮层互相遮挡。
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
      {ringOpen && !dnd && (
        <div className="desk-pet-ring" aria-label="快捷环">
          {QUICK_RING.map((label) => (
            <button
              key={label}
              type="button"
              className="desk-pet-ring-item"
              onClick={() => {
                sendCommandNow(label);
                onQuickAction?.(label);
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
