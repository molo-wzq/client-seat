import { useCallback, useEffect, useRef, useState } from "react";
import type { PetEmotion } from "../shared/agent-contract";
import {
  IDLE_SLEEP_MS,
  POKE_LINES,
  REACTION_HOLD_MS,
  pokeLine,
  reactionExpression,
  type PetReactionEvent,
} from "./pet-reactions";

/** 单击判定延迟(审查 S3):等这一拍确认不是双击,再开/关面板。 */
export const AVATAR_CLICK_DELAY_MS = 250;
/** 气泡自动消失(审查 S9):台词说完就收,不常驻头顶。 */
export const BUBBLE_HOLD_MS = 4000;
/** 连点去重窗口:双击/三连击只算戳一下。 */
const POKE_DEDUPE_MS = 400;

/** 桌宠气泡硬上限 40 字(spec):服务端已截一道,前端展示再兜底。 */
function clampBubble(text: string): string {
  return [...text].slice(0, 40).join("");
}

/**
 * 互动感 hook(工单 12 起,工单 15 抽出):睡、戳、事件反应、气泡与单击/双击判定。
 * 表情优先级归并在 pet-reactions.resolveExpression,这里只收状态。
 * - 单击延迟一拍再判(审查 S3),detail≥2 视为双击/连点→戳一下(连点窗口内去重);
 * - 事件反应到达即醒来,短时表情盖过困倦与对话情绪(审查 S5);
 * - 气泡约 4 秒自动收起(审查 S9),卸载清理全部计时器。
 */
export function usePetMood({ onSingleClick }: { onSingleClick: () => void }) {
  const [sleepy, setSleepy] = useState(false);
  const [activityAt, setActivityAt] = useState(() => Date.now());
  const [pokeCount, setPokeCount] = useState(0);
  const [pokeExpression, setPokeExpression] = useState<PetEmotion | null>(null);
  const [reactionExpr, setReactionExpr] = useState<PetEmotion | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const pokeTimerRef = useRef<number | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const reactionTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const lastPokeAtRef = useRef(0);

  /** 任何与桌宠的互动都算活动:醒来并把闲置计时重置 3 分钟。 */
  const wake = useCallback(() => {
    setSleepy(false);
    setActivityAt(Date.now());
  }, []);

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current === null) return;
    window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
  }, []);

  /** 气泡:说一句,约 4 秒自动收起(审查 S9);新气泡顶掉旧计时。 */
  const say = useCallback((text: string) => {
    setBubble(clampBubble(text));
    if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setBubble(null), BUBBLE_HOLD_MS);
  }, []);

  /** 戳一下:固定台词轮换 + 切表情,不调模型;台词走气泡,同样自动收起;连点窗口内只算一次。 */
  const poke = useCallback(() => {
    const now = Date.now();
    if (now - lastPokeAtRef.current < POKE_DEDUPE_MS) return;
    lastPokeAtRef.current = now;
    wake();
    const line = pokeLine(pokeCount);
    setPokeCount((count) => count + 1);
    say(line.text);
    setPokeExpression(line.expression);
    if (pokeTimerRef.current !== null) window.clearTimeout(pokeTimerRef.current);
    pokeTimerRef.current = window.setTimeout(() => setPokeExpression(null), REACTION_HOLD_MS);
  }, [pokeCount, say, wake]);

  /** 头像点击(审查 S3):单击等一拍再交给上层;双击/连点(detail≥2)直接戳。 */
  const handleAvatarClick = useCallback(
    (detail: number) => {
      if (detail >= 2) {
        clearClickTimer();
        poke();
        return;
      }
      if (clickTimerRef.current !== null) return;
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        onSingleClick();
      }, AVATAR_CLICK_DELAY_MS);
    },
    [clearClickTimer, onSingleClick, poke],
  );

  /** 事件反应:换表情停一下就还回去;待审不换表情(只晃角标)。到达即醒来(审查 S5)。 */
  const reactTo = useCallback(
    (event: PetReactionEvent) => {
      wake();
      const next = reactionExpression(event);
      if (next) setReactionExpr(next);
      if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current);
      reactionTimerRef.current = window.setTimeout(() => setReactionExpr(null), REACTION_HOLD_MS);
    },
    [wake],
  );

  /**
   * 直接换一个短时表情(工单 16):牌局事件由 Worker 落成带表情的 Report 驱动,
   * 情绪值来自 Report.emotion,停一下照常还回去;到达即醒来(同审查 S5)。
   */
  const express = useCallback(
    (emotion: PetEmotion | null) => {
      if (!emotion) return;
      wake();
      setReactionExpr(emotion);
      if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current);
      reactionTimerRef.current = window.setTimeout(() => setReactionExpr(null), REACTION_HOLD_MS);
    },
    [wake],
  );

  // 闲置入睡(工单 12):3 分钟没动静变 sleepy,再点一下醒来(只是表情,不推送)。
  useEffect(() => {
    const timer = window.setTimeout(() => setSleepy(true), IDLE_SLEEP_MS);
    return () => window.clearTimeout(timer);
  }, [activityAt]);

  // 卸载清干净全部计时器(戳、气泡、反应、单击判定)。
  useEffect(() => {
    return () => {
      for (const timer of [pokeTimerRef, bubbleTimerRef, reactionTimerRef, clickTimerRef]) {
        if (timer.current !== null) window.clearTimeout(timer.current);
      }
    };
  }, []);

  return { sleepy, pokeExpression, reactionExpr, bubble, poke, wake, reactTo, express, say, handleAvatarClick, POKE_LINES };
}
