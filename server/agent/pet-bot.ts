import { ValidationError } from "../../src/domain/product-core";
import {
  XIAOBEI_CITED_REPLY_CHARS,
  XIAOBEI_PLAIN_REPLY_CHARS,
  type AgentTriggerInput,
  type ChatContext,
  type EmitOutcome,
  type PetEmotion,
  type XiaobeiChatEvent,
  type XiaobeiChatInput,
  type XiaobeiEvidence,
  type XiaobeiMessage,
} from "../../src/shared/agent-contract";
import { archiveKinds, type createBotArchive } from "./bot-archive";
import { DEFAULT_PET_PERSONA, PET_EMOTIONS, assemblePetSystemPrompt } from "./pet-persona";
import { renderChatContext, type AgentModelMessage, type AgentToolSpec } from "./workers";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const clean = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const EMOTION_TAG = new RegExp(`^\\s*\\[(${PET_EMOTIONS.join("|")})\\]\\s*`);
const SUGGESTION_MARKER = "【建议】";

/** 玩家这句话想办的事。检索/复盘/陪练/审批都从这句话里认,不另开菜单。 */
export type XiaobeiIntent = "annotate" | "approval" | "research" | "review" | "practice" | "talk";

/** 聊天里的拍板。没写工单号时 ticketId 为空,不能拿去套最近一张待审卡。 */
export function readChatDecision(text: string): { verb: "同意" | "驳回"; ticketId?: string; reason?: string } | null {
  const match = /^(同意|驳回)(?:\s+(\S+))?(?:\s+([\s\S]+))?$/.exec(text.trim());
  if (!match) return null;
  const reason = match[3]?.trim();
  return {
    verb: match[1] as "同意" | "驳回",
    ...(match[2] ? { ticketId: match[2] } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function classifyXiaobeiUtterance(text: string, annotateTicketId?: string): XiaobeiIntent {
  if (annotateTicketId && !readChatDecision(text)) return "annotate";
  const trimmed = text.trim();
  if (/^(?:\/投研|本周投研|这周投研)$/.test(trimmed) || /^帮我(?:整理|做|看)?(?:一下)?(?:本周|这周)?投研(?:要点|草稿)?$/.test(trimmed)) {
    return "research";
  }
  if (/陪练|陪我练|角色扮演|练一次/.test(trimmed)) return "practice";
  if (/复盘|上一局|上局/.test(trimmed)) return "review";
  return "talk";
}

export function parseXiaobeiInput(value: unknown): XiaobeiChatInput {
  const input = record(value);
  const text = clean(input.text, 4000);
  const sessionId = clean(input.sessionId, 80);
  if (!sessionId) throw new ValidationError("缺少小贝会话。");
  if (!text) throw new ValidationError("请先输入想交给小贝的事。");
  const context = parseContext(input.context);
  return {
    sessionId,
    text,
    history: array(input.history).slice(-12).flatMap((item) => {
      const row = record(item);
      const speaker = row.speaker;
      const body = clean(row.body ?? row.text, 2400);
      return (speaker === "player" || speaker === "pet") && body ? [{ speaker, body }] : [];
    }),
    notes: array(input.notes).slice(-30).flatMap((item) => {
      const { id, text: noteText } = record(item);
      return typeof id === "string" && typeof noteText === "string"
        ? [{ id: clean(id, 100), text: clean(noteText, 2000), evidence: [] }] : [];
    }),
    gameId: clean(input.gameId, 100) || undefined,
    view: clean(input.view, 40) || undefined,
    ...(context ? { context } : {}),
    annotateTicketId: clean(input.annotateTicketId, 80) || undefined,
    targetTicketId: clean(input.targetTicketId, 80) || undefined,
  };
}

function parseContext(value: unknown): ChatContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const context = value as ChatContext;
  if (context.phase === "idle" && typeof context.act === "string") return context;
  if (context.phase === "game" && typeof context.customer?.name === "string") return context;
  return undefined;
}

const searchTool: AgentToolSpec = {
  type: "function",
  function: {
    name: "search_archive",
    description: "按主题查一个或多个资料库。可以多次换关键词、分别检索并对照。返回可引用的编号和原文。游戏范围默认是所有历史对局。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "一个短关键词；空字符串浏览近期资料" },
        kinds: { type: "array", items: { type: "string", enum: archiveKinds } },
        currentGame: { type: "boolean", description: "只在用户指当前牌局时使用" },
      },
      required: ["query", "kinds"],
    },
  },
};

function clip(text: string, limit: number): string {
  return [...text].slice(0, limit).join("");
}

function stripSuggestion(text: string): string {
  const index = text.indexOf(SUGGESTION_MARKER);
  return index < 0 ? text : text.slice(0, index).trimEnd();
}

function stripEmotion(text: string): { body: string; emotion?: PetEmotion } {
  const match = EMOTION_TAG.exec(text);
  if (!match) return { body: text.trim() };
  return { body: text.slice(match[0].length).trim(), emotion: match[1] as PetEmotion };
}

function finishMessage(raw: string, evidence: XiaobeiEvidence[], steps: string[], ticketId?: string): XiaobeiMessage {
  const { body, emotion } = stripEmotion(stripSuggestion(raw).trim());
  const limit = evidence.length > 0 ? XIAOBEI_CITED_REPLY_CHARS : XIAOBEI_PLAIN_REPLY_CHARS;
  return {
    speaker: "pet",
    body: clip(body, limit),
    ...(emotion ? { emotion } : {}),
    evidence,
    steps,
    ...(ticketId ? { ticketId } : {}),
  };
}

/**
 * 小贝的唯一回合执行器。人格只从人格卡组装。
 * 检索、复盘、陪练在这句对话里做完;要跟踪的活(审批、投研草稿、批注)才另开工单。
 * 绝不把 kind:chat 送进 emitTrigger。
 */
export function createPetBot(deps: {
  archive: ReturnType<typeof createBotArchive>;
  model?: import("./workers").AgentModelPort;
  openWork?: (input: AgentTriggerInput) => Promise<EmitOutcome>;
  /**
   * 点名的拍板:只改那张已有的卡,不另开工单。
   * 没点名时不要调用。
   */
  decideCard?: (input: { verb: "同意" | "驳回"; ticketId: string; reason?: string }) => Promise<{
    acted: boolean;
    label: string;
    detail: string;
  }>;
}) {
  return async (input: XiaobeiChatInput, emit: (event: XiaobeiChatEvent) => void) => {
    const evidence = new Map<string, XiaobeiEvidence>();
    const steps: string[] = [];
    let archive: ReturnType<typeof deps.archive> | undefined;
    const getArchive = () => archive ??= deps.archive(input.notes);
    const search = async (query: string, kinds: (typeof archiveKinds)[number][], gameId?: string) => {
      const index = await getArchive();
      const hits = index.search(query, kinds, gameId);
      for (const hit of hits) if (!evidence.has(hit.id) && evidence.size < 20) evidence.set(hit.id, hit);
      const names = { games: "历史对局", cards: "策略卡", research: "历期投研", notes: "个人笔记" };
      const text = `${gameId ? "查了本局" : "查了" + kinds.map((kind) => names[kind]).join("、")}${query ? `（${query}）` : ""}，找到 ${hits.length} 条`;
      steps.push(text);
      emit({ type: "step", text });
      return {
        results: hits.flatMap((hit) => {
          const i = [...evidence.keys()].indexOf(hit.id);
          return i < 0 ? [] : [{ ...hit, ref: i + 1 }];
        }),
        ...(kinds.includes("research") ? { availablePeriods: index.periods } : {}),
      };
    };
    const done = (raw: string, ticketId?: string) => {
      emit({ type: "done", message: finishMessage(raw, [...evidence.values()], steps, ticketId) });
    };
    const decision = readChatDecision(input.text);
    if (decision) {
      const ticketId = decision.ticketId ?? input.targetTicketId;
      if (!ticketId) {
        done(`[think]你是说${decision.verb}哪张？`);
        return;
      }
      if (!deps.decideCard) {
        done("[think]这张卡的拍板还没接上，我先不动它。");
        return;
      }
      const result = await deps.decideCard({
        verb: decision.verb,
        ticketId,
        ...(decision.reason ? { reason: decision.reason } : {}),
      });
      if (!result.acted) {
        done(`[think]${result.detail || "这张不在待拍板里。"}`);
        return;
      }
      const name = clip(result.label.trim() || ticketId, 40);
      done(decision.verb === "同意"
        ? `[cheer]已同意 ${ticketId}：${name}`
        : `[think]已驳回 ${ticketId}：${name}`);
      return;
    }

    const intent = classifyXiaobeiUtterance(input.text, input.annotateTicketId);

    if (intent === "annotate" || intent === "research") {
      if (!deps.openWork) {
        done("[think]这件要人跟踪的事还没接上，我先不假装已经立项。");
        return;
      }
      const work: AgentTriggerInput = intent === "annotate"
        ? { source: "pet", kind: "annotate", data: { ticketId: input.annotateTicketId, note: input.text } }
        : { source: "pet", kind: "command", data: { text: "本周投研" } };
      if (work.kind === "chat") throw new ValidationError("对小贝说的话不走触发，请改走 /api/agent/chat");
      const outcome = await deps.openWork(work);
      const reportText = outcome.report?.text?.trim();
      const ticketId = outcome.ticket?.id;
      steps.push(ticketId ? `开了跟踪工单 ${ticketId}` : "这件没有另开工单");
      done(reportText ? `[think]${reportText}` : "[think]这件我记下了。", ticketId);
      return;
    }

    const persona = assemblePetSystemPrompt(DEFAULT_PET_PERSONA, input.view);
    const snapshot = input.context ? `\n${renderChatContext(input.context)}` : "";
    const focus = input.context?.phase === "game" && input.context.focusTurn
      ? `\n玩家正在看的经理原话是上面的「当前经理原话」。解释这句时只评经理的招。`
      : "";
    const job = intent === "review"
      ? "\n玩家在要复盘:先查对局和复盘资料再回答,引用出处,只评经理哪招值得看,不要给玩家打分,也不要另开工单。"
      : intent === "practice"
        ? "\n玩家在要陪练:解释当前这句经理原话(若有),给出可以怎么接的说法,但不替玩家选定,也不评价玩家发挥。就在这段对话里练,不要另开工单。"
        : "";
    const messages: AgentModelMessage[] = [
      { role: "system", content: persona + snapshot + focus + job + (input.gameId ? "\n当前在牌局中,可以按需检索本局已发生的对话。" : "") },
      ...input.history.map((entry): AgentModelMessage => ({
        role: entry.speaker === "pet" ? "assistant" : "user", content: entry.body,
      })),
      { role: "user", content: input.text },
    ];

    const forceSearch = intent === "review" || /检索|查一下|找一下|搜一下|比较|笔记|周报|策略卡/.test(input.text);
    let streamed = "";
    const emitDelta = (piece: string) => {
      if (!piece || streamed.includes(SUGGESTION_MARKER)) return;
      const next = streamed + piece;
      const cut = next.indexOf(SUGGESTION_MARKER);
      const visible = cut >= 0 ? next.slice(streamed.length, cut) : piece;
      const withoutLead = streamed === "" ? visible.replace(EMOTION_TAG, "") : visible;
      if (!withoutLead) {
        streamed = next;
        return;
      }
      streamed += withoutLead;
      emit({ type: "delta", text: withoutLead });
    };

    try {
      if (forceSearch && !deps.model?.completeWithTools) {
        const query = input.text.replace(/请|小贝|帮我|复盘|查找|查一下|搜一下|找一下|检索/g, "").slice(0, 100);
        const result = await search(query, [...archiveKinds], /本局|这一局/.test(input.text) ? input.gameId : undefined);
        messages[0].content += "\n以下是本地匹配结果,作为资料引用:" + JSON.stringify(result);
      } else if (deps.model?.completeWithTools) {
        const planning: AgentModelMessage = {
          role: "system",
          content: "当前步骤只负责检索。需要资料就调用工具,资料足够或无须检索时只回复「可以回答」。稍后会单独生成给用户看的正文。",
        };
        for (let round = 0; round < 3; round += 1) {
          const result = await deps.model.completeWithTools([planning, ...messages], [searchTool]);
          if (result.type === "text") break;
          const calls = result.calls.slice(0, 4);
          if (!calls.length) break;
          messages.push({ role: "assistant", content: "", toolCalls: calls });
          for (const call of calls) {
            let args: Record<string, unknown> = {};
            try { args = record(JSON.parse(call.arguments)); } catch { /* 模型参数坏了就当空。 */ }
            const kinds = archiveKinds.filter((kind) => array(args.kinds).includes(kind));
            const output = call.name === searchTool.function.name
              ? args.currentGame === true && !input.gameId ? { error: "当前没有打开的牌局" }
                : await search(clean(args.query, 100), kinds.length ? kinds : [...archiveKinds],
                    args.currentGame === true ? input.gameId : undefined)
              : { error: "没有这个工具" };
            messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: JSON.stringify(output) });
          }
        }
      }
      if (deps.model) {
        const text = await deps.model.completeStream(messages, emitDelta);
        if (text.trim()) {
          done(text);
          return;
        }
      }
    } catch {
      if (streamed) {
        done(`${streamed}\n\n（模型连接中断,可以继续追问。）`);
        return;
      }
    }

    const query = input.text.replace(/请|小贝|帮我|查找|查一下|搜一下|找一下|检索|复盘|陪练/g, "").slice(0, 100);
    if (intent === "practice" && evidence.size === 0) {
      const line = input.context?.phase === "game" ? input.context.focusTurn?.text : undefined;
      done(line
        ? `[think]经理这句是:${clip(line, 40)}。你可以先问清他想确认什么,再决定接多少;我不定你怎么说。`
        : "[wave]行,我陪你练。你先接一句,我只在旁边看经理的招,不替你定。");
      return;
    }
    const { results, availablePeriods } = evidence.size > 0
      ? { results: [...evidence.values()].map((hit, index) => ({ ...hit, ref: index + 1 })), availablePeriods: undefined as string[] | undefined }
      : await search(query, intent === "review" ? ["games"] : [...archiveKinds]);
    if (!results.length) {
      const periods = availablePeriods?.length ? `目前收录的投研期次:${availablePeriods.join("、")}。` : "";
      done(intent === "review"
        ? `[think]还没有能引用的上局复盘。你要看某一局,说个词就行。${periods}`
        : `[wave]我可以直接查对局、策略卡、历期投研和你保存的笔记。当前是本地检索模式。试试一个主题,例如「存款到期」。${periods}`);
      return;
    }
    done("[think]目前是本地检索模式。我找到了这些相关资料:\n\n"
      + results.slice(0, 6).map((hit) => `[${hit.ref}] ${hit.title}\n${hit.excerpt.slice(0, 200)}`).join("\n\n"));
  };
}
