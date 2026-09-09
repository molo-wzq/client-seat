import type {
  CaseAnalysis,
  Conversation,
  ConversationTurn,
  Material,
  MaterialDraftPatch,
  Persona,
  PersonaInput,
  StrategyCard,
  VirtualProductCard,
  VisiblePersona,
} from "./types";
import type { ParsedTurn } from "./transcript";

/**
 * 语言模型适配器边界(spec.md 实现决策):核心领域只依赖
 * 文案生成与对话生成两个接口;适配器可替换,测试使用伪实现。
 */

/** 文案生成:把转写稿提炼为案例分析 + 草稿策略卡。 */
export interface CopywritingPort {
  analyzeTranscript(transcript: string): Promise<TranscriptAnalysis>;
}

/** 单段录音转写输入。录音只跨过转写端口,不作为素材持久化。 */
export interface AudioInput {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** 录音转写:输出可由用户校对、再进入现有素材分析流程的文字。 */
export interface AudioTranscriptionPort {
  transcribeAudio(input: AudioInput): Promise<string>;
}

export interface TranscriptAnalysis {
  analysis: CaseAnalysis;
  /** 未经发布确认的卡,由领域层落库为草稿。 */
  cards: Array<Omit<StrategyCard, "status">>;
  /** 适配器完成的说话人区分;缺省时核心层用转写解析兜底,用户可再纠正。 */
  turns?: ParsedTurn[];
}

export interface ManagerTurnInput {
  /** 仅可见信息;隐藏画像不得进入对话生成。 */
  persona: VisiblePersona;
  /** 只有已发布策略卡会进入对话输入(全量注入,检索语义保留为接口)。 */
  publishedCards: StrategyCard[];
  product: VirtualProductCard;
  /** 本轮客户发言之前的全部轮次。 */
  history: ConversationTurn[];
  customerText: string;
}

export interface ManagerTurnOutput {
  /** 纯对话内容:经理要说的电话口语,无前缀无旁白。 */
  reply: string;
  recognizedSignal?: string;
  currentGoal?: string;
  /** 本轮使用的策略卡 id(须为已发布卡;无对应卡时缺省)。 */
  usedCardId?: string;
  /** 达成合理下一步或客户明确结束时由模型主动收口。 */
  shouldEnd?: boolean;
  endReason?: string;
  outcomeSummary?: string;
}

/** 对话生成:根据客户最新信号与已发布策略生成经理下一轮。 */
export interface DialoguePort {
  generateManagerTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput>;
}

export interface ProductStorage {
  saveMaterial(material: Material): Promise<void>;
  listMaterials(): Promise<Material[]>;
  getMaterial(id: string): Promise<Material | null>;
  saveConversation(conversation: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(): Promise<Conversation[]>;
  savePersona(persona: Persona): Promise<void>;
  listPersonas(): Promise<Persona[]>;
}

export function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
