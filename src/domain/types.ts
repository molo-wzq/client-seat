/** 领域词汇以根目录 CONTEXT.md 为准。 */

export type CardStatus = "draft" | "published";

/** 策略卡来源片段:可追溯到素材与转写轮次。 */
export interface SourceExcerpt {
  materialTitle: string;
  /** 转写轮次区间,如 "T01–T02"。 */
  turnRange: string;
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
  analysis: CaseAnalysis;
  cards: StrategyCard[];
  createdAt: string;
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
  }>;
}
