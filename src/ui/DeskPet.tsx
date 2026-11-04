import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./game-feel";
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

/** 桌宠在牌桌一角陪客户看局,本期只做外壳:不说话、不评价玩家。 */
export function DeskPet({ expression = "wave" }: { expression?: PetExpression }) {
  const [variant, setVariant] = useState<PetVariant>(
    () => (window.localStorage.getItem(VARIANT_KEY) === "m" ? "m" : "f"),
  );
  const [dnd, setDnd] = useState(false);
  const [pos, setPos] = useState<PetPos | null>(loadPos);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  // 拖动基线:按下时的指针与桌宠位置,移动按差值换算,jsdom 里 rect 为 0 也能算对差值。
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const base = dragRef.current;
      if (!base) return;
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
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: pos?.left ?? rect.left,
      baseTop: pos?.top ?? rect.top,
    };
    setDragging(true);
  }

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
      <div className="desk-pet-avatar">
        <img
          src={petImg[variant][expression]}
          alt={`桌宠·${variantLabel[variant]}·${expressionLabel[expression]}`}
          draggable={false}
        />
      </div>
      <div className="desk-pet-actions">
        <button type="button" className="desk-pet-action" onClick={switchVariant}>
          切换{variant === "f" ? "男版" : "女版"}
        </button>
        <button type="button" className="desk-pet-action" onClick={() => setDnd(true)}>
          勿扰
        </button>
      </div>
    </aside>
  );
}
