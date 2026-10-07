/** 领域词汇以根目录 CONTEXT.md 为准。 */

export type CardStatus = "draft" | "published";

/** 素材类型:按客户对通话的总体倾向归类,入库归档项。 */
export type MaterialKind = "顺利沟通" | "软拒绝" | "明确拒绝";

export const MATERIAL_KINDS: readonly MaterialKind[] = ["顺利沟通", "软拒绝", "明确拒绝"];

export function isMaterialKind(value: unknown): value is MaterialKind {
  return typeof value === "string" && (MATERIAL_KINDS as readonly string[]).includes(value);
}

/** 策略卡来源片段:可追溯到素材与转写轮次。 */
export interface SourceExcerpt {
  materialTitle: string;
  /** 转写轮次区间,如 "T01–T02"。 */
  turnRange: string;
  /** 所属素材 id:追溯定位用,避免标题重名错位;旧数据可能缺失。 */
  materialId?: string;
}

/** 案例分析:对一段素材的整体结构化解读(结构对应 l1/case-analysis-template.md)。 */
export interface CaseAnalysis {
  scenario: string;
  customerState: string;
  overallGoal: string;
  stages: Array<{
    name: string;
    turnRange: string;
    purpose: string;
    customerSignals: string;
    advanceLogic: string;
    keyActions: string[];
    representativeQuotes: string[];
  }>;
  strengths: string[];
  /** 不值得复用的动作,可空。 */
  weaknesses: string[];
  actualResult: string;
  reusableConditions: string[];
}

/** 策略卡:从案例分析提炼的最小可复用策略单元(结构对应 l1/strategy-card-template.md)。 */
export interface StrategyCard {
  id: string;
  name: string;
  status: CardStatus;
  sourceExcerpt: SourceExcerpt;
  triggerSignals: string[];
  applicableScenario: string;
  currentPurpose: string;
  actionChain: string[];
  expressionPrinciples: string[];
  referenceScripts: string[];
  applicableConditions: string[];
  stopConditions: string[];
}

/** 生客画像。visible 进入 AI 提示词;hidden 仅约束客户角色,AI 不可读。 */
export interface Persona {
  id: string;
  name: string;
  visible: string[];
  hidden: string[];
}

/** 自定义画像输入:提交什么就保存什么,留空字段保持未知,不自动补全。 */
export interface PersonaInput {
  name: string;
  visible: string[];
  hidden: string[];
}

/** 对话生成可读的画像视图:仅含可见信息,隐藏信息不跨过适配器边界。 */
export interface VisiblePersona {
  id: string;
  name: string;
  visible: string[];
}

/** 虚拟产品卡:产品事实唯一来源,AI 不得使用卡外信息。 */
export interface VirtualProductCard {
  activity: {
    name: string;
    /** 活动面向对象,与产品对象分别记录;旧参数可能未单独保存。 */
    audience?: string;
    deadline: string;
    rule: string;
    tiers: Array<{ amount: string; reward: string }>;
  };
  flexibleProduct: {
    name: string;
    type: string;
    referenceYield: string;
    liquidity: string;
    audience: string;
  };
}

/** 素材:一段含优秀打法的转写稿及其分析产物。 */
export interface Material {
  id: string;
  title: string;
  transcript: string;
  /** 说话人区分后的转写轮次;序号保留转写标注值(允许跳号,严格递增),speaker 可被用户纠正。 */
  turns: MaterialTurn[];
  analysis: CaseAnalysis;
  cards: StrategyCard[];
  createdAt: string;
  /** 素材类型;旧数据可能缺失,视为未分类,不自动补全。 */
  kind?: MaterialKind;
}

/** 转写轮次:number 与轮次区间标注(T01…)按出现顺序对应;speaker 可被用户纠正。 */
export interface MaterialTurn {
  number: number;
  speaker: Speaker;
  text: string;
}

/** 人工对素材草稿的修改:说话人纠正、分析编辑、策略卡编辑(已发布卡不可改)。 */
export interface MaterialDraftPatch {
  turns?: MaterialTurn[];
  analysis?: CaseAnalysis;
  cards?: Array<Omit<StrategyCard, "status">>;
  kind?: MaterialKind;
}

export type Speaker = "customer" | "manager";

export type ObservationFocus = "signals" | "conditions" | "next-step" | "free";

/**
 * 换位体感心情戳:玩家以客户身份听到经理话术后的第一直觉。
 * 与判断/依据同为玩家自产观察,不进经理或裁判输入,仅用于复盘对照。
 */
export type FeelingStamp = "too_slick" | "too_long" | "intrigued" | "touched";

export const FEELING_STAMPS: readonly FeelingStamp[] = ["too_slick", "too_long", "intrigued", "touched"];

export function isFeelingStamp(value: unknown): value is FeelingStamp {
  return typeof value === "string" && (FEELING_STAMPS as readonly string[]).includes(value);
}

export interface FeelingStampMeta {
  key: FeelingStamp;
  /** 完整标签,用于提示与复盘文字。 */
  label: string;
  /** 印章上的单字,走中式图章的视觉。 */
  seal: string;
  /** 一句体感描述,悬停与复盘图例用。 */
  desc: string;
  /** 走势方向:positive 抬升(防备松动),negative 下压(抵触上升)。 */
  tone: "positive" | "negative";
}

export const FEELING_STAMP_META: Record<FeelingStamp, FeelingStampMeta> = {
  too_slick: { key: "too_slick", label: "太油了", seal: "油", desc: "套路感重,戒备上来了", tone: "negative" },
  too_long: { key: "too_long", label: "听不进", seal: "烦", desc: "说得太长太绕,注意力掉了", tone: "negative" },
  intrigued: { key: "intrigued", label: "有点意思", seal: "趣", desc: "被勾起好奇,愿意再听一句", tone: "positive" },
  touched: { key: "touched", label: "被打动", seal: "暖", desc: "觉得被理解,想听下去", tone: "positive" },
};

/** 玩家选择的观察问题与重试来源,不进入经理或裁判输入。 */
export interface ConversationStartOptions {
  observationFocus?: ObservationFocus;
  replayOfId?: string;
}

/** 开局冻结实际资源和画像，来源证据一同保存；不包含新编策略。 */
export interface ConversationResources {
  persona: Persona;
  cards: StrategyCard[];
  evidence: StrategyEvidence[];
}

export interface ReplyRevision {
  turn: ConversationTurn;
  replacedAt: string;
  observation?: PlayerObservation;
}

export interface PlayerObservation {
  managerTurnNumber: number;
  judgement?: 'addressed' | 'missed' | 'uncertain';
  evidence: string;
  nextExperiment: string;
  revealed: boolean;
  marked: boolean;
  /** 换位体感心情戳;旧记录缺失,未盖为空。 */
  feeling?: FeelingStamp;
}

export interface ConversationBranch {
  originalId: string;
  customerTurnNumber: number;
  originalCustomerText: string;
  originalManagerTurn: ConversationTurn;
  /** 原局前情与参数是否有可靠快照；没有时禁止宣称条件相同。 */
  conditionsPreserved: boolean;
}

/** 本轮已验证用卡的来源证据,不随后续素材纠正改变。 */
export interface StrategyEvidence {
  cardId: string;
  cardName: string;
  source: SourceExcerpt;
  sourceTurns: MaterialTurn[];
}

export interface ConversationTurn {
  /** 全局轮次序号,从 1 开始(客户与经理交替计数)。 */
  number: number;
  speaker: Speaker;
  text: string;
  /** 仅经理轮:本轮引用的策略卡 id、识别的客户信号、当前沟通目的。 */
  usedCardId?: string;
  strategyEvidence?: StrategyEvidence;
  /** 仅经理轮:实际生成时的提示词版本,不依赖开局时的版本。 */
  promptVersion?: string;
  recognizedSignal?: string;
  currentGoal?: string;
  /**
   * 仅经理轮:用卡匹配依据(裁判指出话术对应卡中哪个动作)。
   * 是话术生成后的解释候选,不是模型真实思考过程;仅当 usedCardId 存在时有意义。
   */
  cardMatchBasis?: string;
  /**
   * 仅经理轮:裁判按通话逻辑(四条钱规律)对本轮话术的一句归因候选
   * (如「地图未画完就报了数字」)。同 cardMatchBasis,是解释候选非思考记录。
   */
  logicHint?: string;
  /** 裁判提出的事实核对候选,须结合本局参数核对,不是错误判决。 */
  factCheckNotes?: string[];
  /**
   * 仅经理轮:确定性守卫——话术里出现白名单外的数字(产品卡事实、
   * 本局客户口述、此前经理已报过的数字之外)。只标不拦,复盘如实呈现。
   */
  outOfCardFact?: boolean;
  /**
   * 仅经理轮:当轮话术生成时模型的思考通道原文(reasoning_content)。
   * 是生成侧真实过程记录,与裁判解释候选(cardMatchBasis/logicHint)区分;
   * 只用于复盘展示,绝不进入下一轮生成输入。旧记录无此字段,如实缺失。
   */
  managerReasoning?: string;
}

export type ConversationStatus = "ongoing" | "ended";

export interface Conversation {
  id: string;
  /** 持久变更序号用于忽略网络延迟造成的旧响应；旧记录缺省。 */
  revision?: number;
  personaId: string;
  observationFocus?: ObservationFocus;
  replayOfId?: string;
  /** 开局时的虚拟产品事实,旧记录缺失不回填。 */
  productFacts?: VirtualProductCard;
  resources?: ConversationResources;
  openingGoal?: string;
  revisions?: ReplyRevision[];
  branch?: ConversationBranch;
  observations?: PlayerObservation[];
  status: ConversationStatus;
  turns: ConversationTurn[];
  endReason?: string;
  outcomeSummary?: string;
  createdAt: string;
  /** 开局时的经理提示词版本;各轮实际版本另存,旧记录不回填。 */
  promptVersion?: string;
}

/** 结果页视图:解释本轮打法,不评价扮演客户的用户。 */
export interface ConversationResult {
  conversationId: string;
  observationFocus?: ObservationFocus;
  replayOfId?: string;
  productFacts?: VirtualProductCard;
  resources?: ConversationResources;
  revisions?: ReplyRevision[];
  branch?: ConversationBranch;
  observations?: PlayerObservation[];
  lastAction?: string;
  mainGoal: string;
  outcome: string;
  endReason: string;
  turns: ConversationTurn[];
  /** 本局提示词版本;旧记录缺信息时为空,复盘页如实标注。 */
  promptVersion?: string;
  strategyPath: Array<{
    turnNumber: number;
    cardId: string;
    cardName: string;
    /** 关键表达:经理本轮实际说出的话。 */
    keyExpression: string;
    /** 客户本轮原话:触发这句经理回应的上一条客户发言。 */
    customerText: string;
    /** 系统识别的客户信号(解释候选);缺失时如实为空。 */
    recognizedSignal?: string;
    /** 经理本轮沟通目的(解释候选);缺失时如实为空。 */
    currentGoal?: string;
    /** 用卡匹配依据(裁判指出对应卡中哪个动作);缺失时按"未确认"展示。 */
    matchBasis?: string;
    source: SourceExcerpt | null;
    /** 原始转写片段:按来源区间解析出的素材轮次;无法解析时为空。 */
    sourceTurns: MaterialTurn[];
    /** 缺失为旧记录,只能用当前素材库回溯。 */
    evidenceOrigin?: "turn-snapshot" | "current-library";
  }>;
}
