import fs from "node:fs";
import path from "node:path";
import type { CurrentResearchReport } from "../src/domain/research-report";

/**
 * 周报拆解服务:
 * 负责解析周报成稿 HTML（或提取配置），自动拆解出 4 个即查抽屉数据，
 * 存为 data/reports/current-sections.json。
 */

export function buildDefaultResearchReport(reportHtmlRelPath = "/reports/weekly-report.html"): CurrentResearchReport {
  return {
    id: "2026-10-23",
    title: "周度投研分析报告 (2026年第42周)",
    period: "2026-10-19 ~ 2026-10-23",
    updatedAt: "2026-10-24T08:00:00.000Z",
    reportHtmlPath: reportHtmlRelPath,
    sections: {
      macro: {
        title: "宏观温度计与开场破冰",
        headline: "A股已进入历史底部区间，宏观增长预期上修，仓位从「纯防守」微调至「防守反击」",
        temperature: "大盘处于历史估值41.5%分位 · 震荡筑底温和偏多",
        cards: [
          {
            title: "核心研判一句话",
            tag: "总纲",
            content: "东吴证券与多家机构判断：上证与沪深300估值处于历史中低水位，三季度GDP 4.5%与工业数据超预期，基本面支撑由预期切换至数据验证，短期维持大盘3200点中枢震荡。",
          },
          {
            title: "破冰开场白：大盘震荡客",
            tag: "电销开场",
            content: "“张总您好！我是咱们工行客户经理小王。看这周大盘一直在3200点反复拉锯，很多老客户都在问方向。咱们总行投研最新研判大资金正在从短炒向低估值红利调仓，今天想跟您聊聊怎么把行外的钱避避风头。”",
            copyableText: "张总您好！我是咱们工行客户经理小王。看这周大盘一直在3200点反复拉锯，很多老客户都在问方向。咱们总行投研最新研判大资金正在从短炒向低估值红利调仓，今天想跟您聊聊怎么把行外的钱避避风头。",
          },
          {
            title: "破冰开场白：存量稳健客",
            tag: "存量触达",
            content: "“刘阿姨好！最近存款和理财利率全线下调，咱们行这周刚下发了面向老客户的稳健增益安排，综合年化比普通存款多出近一个点，正适合您近期的闲置资金，这会儿方便耽误您一分钟吗？”",
            copyableText: "刘阿姨好！最近存款和理财利率全线下调，咱们行这周刚下发了面向老客户的稳健增益安排，综合年化比普通存款多出近一个点，正适合您近期的闲置资金，这会儿方便耽误您一分钟吗？",
          },
        ],
      },
      sector: {
        title: "行业轮动与主线方向",
        summary: "高低切换明显：自主可控科技与低波红利两头受宠，成长与价值哑铃配置防踏空。",
        leadingSectors: [
          { name: "半导体/AI算力", change: "+3.8%", reason: "自主可控催化，资金持续流入头部ETF" },
          { name: "低波红利/银行", change: "+1.2%", reason: "高股息避险底仓配置，防御属性稳固" },
          { name: "人形机器人", change: "+2.5%", reason: "产业端量产落地预期增强，景气度提升" },
        ],
        defensiveSectors: [
          { name: "纯债与存单", change: "+0.08%", reason: "资金回流固收，降息周期下确定性最高" },
          { name: "黄金/避险贵金属", change: "-4.0%", reason: "本周深度回调，中长期对冲窗口再现" },
        ],
        cards: [
          {
            title: "客户追问热门科技板块",
            tag: "热点应对",
            content: "“如果客户问芯片或科技还能不能追，切忌直接回答能或不能。建议回复：‘科技行业长期弹性大，但单边追高容易被波动震出来。我们一般建议客户不超过10%小额定投，同时大头拿纯债打底，涨了能跟上，跌了心里不慌。’”，",
            copyableText: "科技行业长期弹性大，但单边追高容易被波动震出来。我们一般建议客户不超过10%小额定投，同时大头拿纯债打底，涨了能跟上，跌了心里不慌。",
          },
        ],
      },
      product: {
        title: "资产配置与重点产品推荐",
        allocationAdvice: {
          conservative: "防御层45%（低波固收+为主，熨平波动，居民理财刚需）",
          balanced: "均衡层35%（红利低波 + 核心宽基，稳吃分红票息）",
          aggressive: "进攻层20%（AI算力/机器人高景气ETF + 回调后的黄金）",
        },
        featuredPool: [
          {
            name: "华夏智鑫债券（A类029479 / C类029480）",
            type: "二级债基（新发首发）",
            highlight: "固收打底+AI量化增强，聚焦高股息红利，代表作近3年最大回撤仅-1.33%",
          },
          {
            name: "安信平稳双利3个月持有（A类009766）",
            type: "固收+ / 3个月持有",
            highlight: "极低波动运作，适合承接大额存单到期、他行搬家资金",
          },
          {
            name: "工银理财·添利宝每日开放",
            type: "R1现金管理",
            highlight: "T+0快速到账，收益高于活期，适合随时急用的过渡资金",
          },
        ],
        cards: [
          {
            title: "实战推荐话术：华夏智鑫债券（首发标的）",
            tag: "主推话术",
            content: "“波动市里最怕追涨杀跌，咱们工行的配置做法是底仓必须放在控回撤能力强的固收+上——比如下周一新首发的华夏智鑫债券就是这类：二级债基、AI量化选股，代表作近三年最大回撤只有1.33%——小部分仓位跟着产业趋势走，两头都不踏空。”",
            copyableText: "波动市里最怕追涨杀跌，咱们工行的配置做法是底仓必须放在控回撤能力强的固收+上——比如下周一新首发的华夏智鑫债券就是这类：二级债基、AI量化选股，代表作近三年最大回撤只有1.33%——小部分仓位跟着产业趋势走，两头都不踏空。",
          },
          {
            title: "实战话术：应对「定期没到期」",
            tag: "促成技巧",
            content: "“阿姨，定期没到期肯定不动，利息不能白白损失！咱们这次活动是先帮您把代发专属名额登记上，等您下个月定期到期了再转入，名额先锁定，一举两得。”",
            copyableText: "阿姨，定期没到期肯定不动，利息不能白白损失！咱们这次活动是先帮您把代发专属名额登记上，等您下个月定期到期了再转入，名额先锁定，一举两得。",
          },
        ],
      },
      risk: {
        title: "客户异议答疑与风险矩阵",
        summary: "面对客户对波动的顾虑，先共情、再锚定固收属性，不争辩行情。",
        objections: [
          {
            question: "客户说：「现在行情太差了，买理财肯定亏，我不敢买」",
            reply: "“太理解您的心情了，之前行情震荡确实让人心悬。所以今天跟您推荐的不是股票类，是AAA级央企债券打底的纯债，成立以来走势非常稳健，咱们不博高收益，先把稳稳的票息收益落袋为安。”",
          },
          {
            question: "客户说：「放你们行利率才这么点，别家银行给得更高」",
            reply: "“您看得真仔细！不过现在全行业利率都在调降，小银行利率看着略高但往往要锁死好几年不能动。咱们这期活动叠加上专属代发补贴，综合算下来收益不吃亏，而且急用时灵活性高得多。”",
          },
        ],
        nextWeekWatch: [
          "10月28日：9月规模以上工业企业利润数据发布",
          "10月31日：国家统计局公布10月官方PMI（重点看新订单指数）",
          "海外：美联储议息会议前夕官员静默期，美元指数高位震荡",
        ],
      },
    },
  };
}

/**
 * 加载当前最新周报分段数据:
 * 优先读取 data/reports/current-sections.json；若不存在则自动生成种子并落盘。
 */
export function loadCurrentResearchReport(baseDir: string): CurrentResearchReport {
  const jsonPath = path.join(baseDir, "data", "reports", "current-sections.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, "utf-8");
      return JSON.parse(raw) as CurrentResearchReport;
    } catch {
      // 容错降级
    }
  }
  const defaultReport = buildDefaultResearchReport();
  try {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(defaultReport, null, 2), "utf-8");
  } catch {
    // 忽略写入失败
  }
  return defaultReport;
}
