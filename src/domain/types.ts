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
  /** 说话人区分后的转写轮次;序号连续(1..n),允许用户纠正说话人。 */
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

export interface ConversationTurn {
  /** 全局轮次序号,从 1 开始(客户与经理交替计数)。 */
  number: number;
  speaker: Speaker;
  text: string;
  /** 仅经理轮:本轮引用的策略卡 id、识别的客户信号、当前沟通目的。 */
  usedCardId?: string;
  recognizedSignal?: string;
  currentGoal?: string;
}

export type ConversationStatus = "ongoing" | "ended";

export interface Conversation {
  id: string;
  personaId: string;
  status: ConversationStatus;
  turns: ConversationTurn[];
  endReason?: string;
  outcomeSummary?: string;
  createdAt: string;
}

/** 结果页视图:解释本轮打法,不评价扮演客户的用户。 */
export interface ConversationResult {
  conversationId: string;
  mainGoal: string;
  outcome: string;
  endReason: string;
  turns: ConversationTurn[];
  strategyPath: Array<{
    turnNumber: number;
    cardId: string;
    cardName: string;
    /** 关键表达:经理本轮实际说出的话。 */
    keyExpression: string;
    source: SourceExcerpt | null;
    /** 原始转写片段:按来源区间解析出的素材轮次;无法解析时为空。 */
    sourceTurns: MaterialTurn[];
  }>;
}
