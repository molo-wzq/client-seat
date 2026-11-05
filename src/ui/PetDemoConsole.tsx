import { useEffect, useRef, useState } from "react";
import type { AcceptMode } from "../shared/agent-contract";
import type { AgentClient } from "./agent-client";
import type { PetExpression } from "./DeskPet";
import {
  HiddenCards,
  attributionNote,
  hiddenMissNote,
  settleHiddenCards,
  type HiddenCardChoice,
} from "./HiddenCards";
import {
  DEMO_CARDS,
  DEMO_HIDDEN_ITEMS,
  DEMO_STEPS,
  DEMO_TURNS,
  DEFAULT_HOLD_MS,
  currentDemoStep,
  initialDemoState,
  pauseDemo,
  playDemo,
  resetDemo,
  stepDemo,
  type DemoAction,
  type DemoScene,
} from "./pet-demo";

/** 第②幕台账里的一条出招:原话 + 用卡 + 桌宠反应。 */
interface DemoMove {
  move: string;
  cardName?: string;
  reactionLabel: string;
}

/** 动作解释器的依赖缝:组件把 agent 与舞台状态注入,动作保持纯数据(见 runDemoAction)。 */
interface DemoIO {
  agent: AgentClient;
  onPetExpression?: (expression: PetExpression | null) => void;
  onFocusPanel?: (panel: "tickets" | "inbox" | "none") => void;
  /** 放权切换成功的上报:App 递增信号,开着的待办面板重拉后开关立即同步。 */
  onPolicyChange?: (mode: AcceptMode) => void;
  setScene: (scene: DemoScene) => void;
  setMoves: (updater: (prev: DemoMove[]) => DemoMove[]) => void;
  setReview: (review: { text: string } | null) => void;
  /** 最近一次拖入素材的工单号:批注动作靠它唤醒原工单。 */
  lastDroppedTicket: { current: string | null };
}

/**
 * 解释执行一步内的动作(工单 10):命令/触发走真实 agent 链路,失败静默不报错;
 * dropped 的结果工单号记下,供 annotate-last-drop 用真实工单号唤醒原工单;
 * game-ended 的 ready Report 就是复盘一句话,落进结算舞台。
 */
function runDemoAction(action: DemoAction, io: DemoIO): void {
  switch (action.kind) {
    case "pet":
      io.onPetExpression?.(action.expression);
      break;
    case "manager-move":
      io.setMoves((prev) => [
        ...prev,
        { move: action.move, cardName: action.cardName, reactionLabel: action.reactionLabel },
      ]);
      io.onPetExpression?.(action.reaction);
      break;
    case "command":
      void io.agent.sendCommand(action.text).catch(() => undefined);
      break;
    case "trigger":
      void io.agent
        .sendTrigger(action.input)
        .then((outcome) => {
          if (action.input.kind === "dropped" && outcome.ticket) {
            io.lastDroppedTicket.current = outcome.ticket.id;
          }
          if (
            action.input.kind === "game-ended" &&
            outcome.report?.status === "ready" &&
            outcome.report.basis
          ) {
            io.setReview({ text: outcome.report.text });
          }
        })
        .catch(() => undefined);
      break;
    case "annotate-last-drop": {
      const ticketId = io.lastDroppedTicket.current;
      // 前面没有拖入工单(比如直接跳步)就不发,不报错。
      if (!ticketId) break;
      void io.agent
        .sendTrigger({ source: "pet", kind: "annotate", data: { ticketId, note: action.note } })
        .catch(() => undefined);
      break;
    }
    case "policy":
      void io.agent
        .setAcceptMode(action.mode)
        .then(() => io.onPolicyChange?.(action.mode))
        .catch(() => undefined);
      break;
    case "focus":
      io.onFocusPanel?.(action.panel);
      break;
    case "scene":
      io.setScene(action.scene);
      break;
  }
}

/**
 * 一键演示控制条(工单 10,spec 故事 15):右上角 播放/暂停/下一步/重置,
 * 显示 当前步/总步 与一句说明;按 DEMO_STEPS 数据驱动 7 幕。
 * 状态推进全部走 pet-demo 纯函数,组件只解释动作与渲染舞台。
 */
export function PetDemoConsole({
  agent,
  onPetExpression,
  onFocusPanel,
  onPolicyChange,
  onClose,
}: {
  agent: AgentClient;
  /** 演示接管桌宠表情(点头/鼓腮/惊讶…);null 表示还回去。 */
  onPetExpression?: (expression: PetExpression | null) => void;
  /** 演示请 App 打开桌宠的哪个面板(工单列表/待办面板)。 */
  onFocusPanel?: (panel: "tickets" | "inbox" | "none") => void;
  /** 演示切过放权(工单 10):上报新模式,App 递增信号让开着的开关立即同步。 */
  onPolicyChange?: (mode: AcceptMode) => void;
  onClose?: () => void;
}) {
  const [state, setState] = useState(initialDemoState);
  const [scene, setScene] = useState<DemoScene>("none");
  const [moves, setMoves] = useState<DemoMove[]>([]);
  const [choices, setChoices] = useState<Record<string, HiddenCardChoice>>({});
  const [review, setReview] = useState<{ text: string } | null>(null);
  const lastDroppedTicket = useRef<string | null>(null);
  // 每步动作只执行一次:开发环境 StrictMode 会重放 effect,别把触发发两遍。
  const ranIndex = useRef(-1);

  const step = currentDemoStep(state);

  // 进入一步即解释执行它的动作(含重置后回到第 1 步的重演)。
  useEffect(() => {
    if (!step || ranIndex.current === state.index) return;
    ranIndex.current = state.index;
    const io: DemoIO = {
      agent,
      onPetExpression,
      onFocusPanel,
      onPolicyChange,
      setScene,
      setMoves,
      setReview,
      lastDroppedTicket,
    };
    for (const action of step.actions) runDemoAction(action, io);
    // 动作是数据,解释器只依赖这几个稳定引用;逐字面列全以免漏跑。
  }, [state.index, step, agent, onPetExpression, onFocusPanel, onPolicyChange]);

  // 自动播放:到点进下一步;暂停或演完时计时器随之清掉。
  useEffect(() => {
    if (!state.playing || !step) return;
    const timer = window.setTimeout(
      () => setState((current) => stepDemo(current)),
      step.holdMs ?? DEFAULT_HOLD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state.playing, state.index, step]);

  function reset() {
    setState((current) => resetDemo(current));
    ranIndex.current = -1; // 允许第 1 步动作重演(挥手、清舞台)
    setScene("none");
    setMoves([]);
    setChoices({});
    setReview(null);
    onPetExpression?.(null);
    onFocusPanel?.("none");
  }

  return (
    <section className="pet-demo" role="region" aria-label="演示控制条">
      <div className="pet-demo-bar">
        <button
          type="button"
          aria-label={state.playing ? "暂停" : "播放"}
          disabled={!step}
          onClick={() => setState((current) => (current.playing ? pauseDemo(current) : playDemo(current)))}
        >
          {state.playing ? "暂停" : "播放"}
        </button>
        <button type="button" aria-label="下一步" disabled={!step} onClick={() => setState((current) => stepDemo(current))}>
          下一步
        </button>
        <button type="button" aria-label="重置" onClick={reset}>
          重置
        </button>
        {onClose && (
          <button type="button" aria-label="关闭演示" onClick={onClose}>
            ×
          </button>
        )}
        <p className="pet-demo-counter" aria-live="polite">
          {step ? `第 ${state.index + 1}/${DEMO_STEPS.length} 步` : `演示完毕 ${DEMO_STEPS.length}/${DEMO_STEPS.length} 步`}
        </p>
      </div>
      <p className="pet-demo-note">{step ? step.note : "演示完毕,点「重置」再看一遍"}</p>
      <div className="pet-demo-stage" role="region" aria-label="演示舞台">
        {scene === "none" && <p className="pet-demo-hint">看右下角的桌宠 →</p>}
        {scene === "table" && (
          <ol className="pet-demo-moves" aria-label="经理出招">
            {moves.map((item, index) => (
              <li className="pet-demo-move" key={index}>
                <span className="pet-demo-move-text">
                  {item.move}
                  {item.cardName ? `（用『${item.cardName}』）` : ""}
                </span>
                <span className="pet-demo-reaction">桌宠·{item.reactionLabel}</span>
              </li>
            ))}
          </ol>
        )}
        {scene === "hidden-cards" && (
          <HiddenCards
            items={DEMO_HIDDEN_ITEMS}
            turns={DEMO_TURNS}
            cards={DEMO_CARDS}
            choices={choices}
            onChoice={(item, choice) => setChoices((prev) => ({ ...prev, [item]: choice }))}
          />
        )}
        {scene === "settle" && (
          <div className="pet-demo-settle">
            <ul aria-label="结算揭晓">
              {settleHiddenCards(DEMO_HIDDEN_ITEMS, DEMO_TURNS, DEMO_CARDS, choices).map((card, index) => (
                <li className="pet-demo-settle-card" key={index} data-revealed={card.revealed || undefined}>
                  {card.revealed ? `已翻:${card.item}(${attributionNote(card)})` : `未翻:${card.item}——${hiddenMissNote(card)}`}
                </li>
              ))}
            </ul>
            {review && (
              <p className="pet-demo-review" role="status">
                桌宠复盘:{review.text}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
