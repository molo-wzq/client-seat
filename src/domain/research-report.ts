/**
 * 周度投研报告领域模型与分段结构:
 * 周报由周报技能生成完整的 14 章专业 HTML，在对练系统中自动拆解为 4 个
 * 针对理财经理实操通话的即查即用分段（抽屉数据），每周数据源更新即可，
 * 前端界面与核心流程零改动。
 */

export interface ScriptCard {
  title: string;
  tag?: string;
  content: string;
  /** 可直接复制到剪贴板用于电销/微信跟进的纯文本话术 */
  copyableText?: string;
}

/** 宏观与开场分段 */
export interface MacroSection {
  title: string;
  headline: string;
  temperature: string;
  cards: ScriptCard[];
}

/** 行业轮动主线分段 */
export interface SectorSection {
  title: string;
  summary: string;
  leadingSectors: Array<{ name: string; change: string; reason: string }>;
  defensiveSectors: Array<{ name: string; change: string; reason: string }>;
  cards: ScriptCard[];
}

/** 资产配置与产品推荐分段 */
export interface ProductAllocationSection {
  title: string;
  allocationAdvice: {
    conservative: string;
    balanced: string;
    aggressive: string;
  };
  featuredPool: Array<{
    name: string;
    code?: string;
    type: string;
    highlight: string;
  }>;
  cards: ScriptCard[];
}

/** 客户异议答疑与风险矩阵分段 */
export interface RiskObjectionSection {
  title: string;
  summary: string;
  objections: Array<{
    question: string;
    reply: string;
  }>;
  nextWeekWatch: string[];
}

/** 整份结构化分段报告模型 */
export interface CurrentResearchReport {
  id: string;
  title: string;
  period: string;
  updatedAt: string;
  reportHtmlPath: string;
  sections: {
    macro: MacroSection;
    sector: SectorSection;
    product: ProductAllocationSection;
    risk: RiskObjectionSection;
  };
}
