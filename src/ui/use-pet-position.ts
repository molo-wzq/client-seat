import { useRef, useState } from "react";

/**
 * 位置与拖动 hook(工单 15,审查 S4):挪过阈值才算拖并鼓腮;
 * pointercancel 同样收尾;拖完松手的补偿 click 由 draggedRef 让上层忽略。
 */

type PetPos = { left: number; top: number };

const POS_KEY = "desk-pet-pos";
/** 拖动阈值(审查 S4):按下后挪过 4px 才算拖,单击/在输入框选字不被吞。 */
const DRAG_THRESHOLD_PX = 4;

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

export function usePetPosition({
  rootRef,
  onInteract,
}: {
  rootRef: { readonly current: HTMLElement | null };
  /** 按下即算互动(叫醒)。 */
  onInteract: () => void;
}) {
  const [pos, setPos] = useState<PetPos | null>(loadPos);
  const [dragging, setDragging] = useState(false);
  /** 按下后是否真的拖动过:拖完松手浏览器仍会补发 click,别让它误开面板。 */
  const draggedRef = useRef(false);

  /** 拖动只认头像:全局监听在按下时挂、收尾时摘,不留常驻监听。 */
  function onAvatarPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    onInteract();
    // 手机端(≤820px)桌宠固定在顶栏,不支持拖动:手指轻抖超过阈值会吞掉点击(见 mobile.css)。
    if (window.matchMedia?.("(max-width: 820px)").matches) return;
    const rect = root.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let baseLeft = pos?.left ?? rect.left;
    let baseTop = pos?.top ?? rect.top;
    let draggingNow = false;
    draggedRef.current = false;
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - startX;
      const dy = move.clientY - startY;
      if (!draggingNow) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        draggingNow = true;
        draggedRef.current = true;
        setDragging(true);
      }
      const next = { left: baseLeft + dx, top: baseTop + dy };
      // 重定基线:finish 时基线就是最新位置,直接落盘。
      baseLeft = next.left;
      baseTop = next.top;
      setPos(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (draggingNow) {
        setDragging(false);
        savePos({ left: baseLeft, top: baseTop });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  return { pos, dragging, draggedRef, onAvatarPointerDown };
}
