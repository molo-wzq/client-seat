import { describe, expect, it } from "vitest";
import { assembleAnalystSystemPrompt, assembleManagerMetaPrompt, assembleManagerSystemPrompt } from "./prompts";
import {
  SEED_CARDS,
  SEED_PERSONA,
  SEED_PERSONA_P02,
  SEED_PERSONA_P03,
  SEED_PRODUCT_CARD,
} from "../domain/seed";

/**
 * 规则 9 客户属性防护(票 11):真实模型曾在可见信息无"代发"时
 * 把客户称作「代发客户」(demo-03)。提示词必须给出带反例的明确禁令,
 * 且开场来意示例与策略卡示例不得诱导身份断言。
 */
const P03_VISIBLE = SEED_PERSONA_P03.visible;

function promptFor(visible: string[]): string {
  return assembleManagerSystemPrompt({
    persona: { id: "p-test", name: "测试画像", visible },
    publishedCards: SEED_CARDS,
    product: SEED_PRODUCT_CARD,
  });
}

describe("经理系统提示词:规则 6(原 9)客户属性防护", () => {
  it("可见信息无代发时,提示词含带反例的明确禁令", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("不凭空假设客户属性");
    // 反例点名具体身份类别,不含糊。
    expect(prompt).toContain("不得称客户为「代发客户」");
    expect(prompt).toContain("贵宾");
    expect(prompt).toContain("三方存管");
  });

  it("写明「产品事实可说、客户身份不可断言」的边界", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("不得据此断言客户本人属于该类");
  });

  it("策略卡示例中的客户属性仅在可见信息支持时使用", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("仅当可见信息支持时才对客户使用");
  });

  it("骨架占位符须填充或改用自然称呼,不得原样输出(票11 并入病灶)", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toMatch(/占位符/);
    expect(prompt).toMatch(/不得原样输出/);
  });

  it("开场来意示例不再以「代发客户」为固定例子(旧诱导措辞移除)", () => {
    for (const visible of [P03_VISIBLE, SEED_PERSONA.visible]) {
      const prompt = promptFor(visible);
      expect(prompt).not.toContain("如告知代发客户的资金活动");
    }
  });

  it("规则 4(原 6)收口渠道句:一句为限、无后续钩子;经理身份由角色区固定", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toMatch(/礼貌收口[\s\S]{0,80}联系渠道/);
    expect(prompt).toContain("一句为限");
    expect(prompt).toContain("过阵子再联系");
    // p3:身份不再靠"不编造姓名"约束,而是角色区给定固定身份。
    expect(prompt).toContain("理财经理小李");
    expect(prompt).toContain("不另起名字");
  });

  it("可见信息本身仍完整进入提示词(代发画像不受影响)", () => {
    const prompt = promptFor(SEED_PERSONA.visible);
    expect(prompt).toContain("代发工资客户,代发关系正常");
  });
});

describe("分析提示词:场景读法(票 14)", () => {
  it("区分「到账」与「到期」,按转写原文用词判断、不得混用", () => {
    const prompt = assembleAnalystSystemPrompt();
    expect(prompt).toContain("区分「到账」与「到期」");
    expect(prompt).toContain("期限届满");
    expect(prompt).toContain("不得混用");
    expect(prompt).toMatch(/按转写原文用词判断/);
  });
});

describe("两段式输出契约(票 29)", () => {
  it("经理话术提示词要求纯文本输出,不再索要 JSON", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).not.toContain("只输出 JSON");
    expect(prompt).toMatch(/不加「理财经理:」等称谓前缀/);
    expect(prompt).toMatch(/不输出 JSON/);
  });

  it("元数据裁判提示词给出卡清单并只索要 JSON", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: SEED_CARDS });
    expect(prompt).toContain("usedCardId 只能取这里的 id");
    for (const card of SEED_CARDS) {
      expect(prompt).toContain(card.id);
      expect(prompt).toContain(card.name);
    }
    expect(prompt).toContain("只输出 JSON");
    expect(prompt).not.toContain("reply");
  });

  it("无已发布卡时裁判提示词写明空库", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: [] });
    expect(prompt).toContain("无已发布策略卡");
  });
});

describe("KYC 探询质量(票 30)", () => {
  it("规则 3(原 4)给出资金现状最小清单,行外资金优先", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("行外资金");
    expect(prompt).toContain("他行存款/他行理财/证券/定期");
    expect(prompt).toContain("闲置资金大概多少");
    expect(prompt).toMatch(/优先摸清/);
  });

  it("规则 7(原 11)探询纪律:一次一问、线索后追问一层、空转即收手", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("一次只问一个问题");
    expect(prompt).toContain("先接住确认,再顺着追问一层");
    expect(prompt).toContain("不拿到一个线索就急着推产品");
    expect(prompt).toContain("连续两轮没有新信息就停止追问");
  });

  it("分析提示词要求探询类动作链写明维度与追问", () => {
    const prompt = assembleAnalystSystemPrompt();
    expect(prompt).toContain("问的是哪个维度");
    expect(prompt).toContain("客户给出线索后追问什么");
    expect(prompt).toContain("这类空动作的卡不可复用");
  });
});

describe("拒绝计数与挂断门槛(客户拒绝三次再挂电话)", () => {
  it("规则 4(原 5/6 合一):软拒绝与明确拒绝累计计数,前两次接住继续、不收口", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("软拒绝(再考虑/暂时不用/到时候看)与明确拒绝(不用了/别打了/要挂了)都算");
    expect(prompt).toContain("累计第一次、第二次拒绝");
    expect(prompt).toContain("不得收口挂断");
    // 策略卡停止条件与三次门槛冲突时,以硬性规则为准。
    expect(prompt).toContain("以本条为准");
  });

  it("规则 4(原 6):累计第三次拒绝才礼貌收口挂断", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("客户累计第三次拒绝");
    expect(prompt).toContain("礼貌收口挂断");
  });

  it("裁判提示词:shouldEnd 以累计三次拒绝或达成下一步为准", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: SEED_CARDS });
    expect(prompt).toContain("客户累计拒绝达到三次");
    expect(prompt).toContain("不足三次一律为 false");
  });
});

describe("提示词分层与生成输入补全(dialogue-guardrails spec B/C)", () => {
  it("系统提示词按层组织:角色与规则(稳定)在前,本局画像/产品/策略卡随后", () => {
    const prompt = promptFor(P03_VISIBLE);
    const layers = [
      "## 你的角色(所有对局相同)",
      "## 通话逻辑(所有对局相同——这通电话为什么能成)",
      "## 通话规则(所有对局相同)",
      "## 本局客户画像(你已知的全部客户信息)",
      "## 本局事实(通话逻辑的可变参数)",
      "## 本局策略卡(已发布卡全部在桌上",
    ];
    let cursor = -1;
    for (const layer of layers) {
      const at = prompt.indexOf(layer);
      expect(at, `缺少分层标题:${layer}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("formatCard 补齐素材到策略入口遗漏的条件:适用场景与适用条件进入生成输入", () => {
    const prompt = promptFor(SEED_PERSONA.visible);
    expect(prompt).toContain("适用场景:存量生客首次触达");
    expect(prompt).toContain("适用条件:");
    // SC2 的适用条件逐条可见,不再是只有触发信号与停止条件。
    expect(prompt).toContain("客户愿意回答现状问题(连续两个问题都得到回应)");
  });

  it("参考话术以「学腔调」进入生成输入:真实原话作语体样本(p3 推翻整段不入)", () => {
    const prompt = promptFor(SEED_PERSONA.visible);
    expect(prompt).toContain("参考话术(真实通话原话,学腔调不照抄)");
    // 种子卡的真实原话上桌,给模型可模仿的口语节奏。
    expect(prompt).toContain("哎,您好,客户A您好");
    // 骨架带〔〕填空标记,与规则 6 的占位符填充说明配套。
    expect(prompt).toContain("骨架:您好,〔客户称呼〕");
  });

  it("角色区不再硬编码首次触达:关系以本局画像写明的为准", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).not.toContain("首次触达电话");
    expect(prompt).toContain("按首次接触对待");
    // P02 已相识画像下,提示词同样允许按写明关系开口。
    const p02Prompt = promptFor(SEED_PERSONA_P02.visible);
    expect(p02Prompt).toContain("写明已相识或曾沟通过,就按该关系开口");
  });

  it("规则9 活动资格三分口径:已证实推进、未满足/未知条件式,不断言", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("活动资格按画像口径分三种");
    expect(prompt).toContain("不得断言客户本人能参加");
    expect(prompt).toContain("也不得断言客户永远不能参加");
  });
});

describe("元数据裁判:动作链与匹配依据(spec D)", () => {
  it("裁判提示词带每张卡的动作链,不再只有卡名与目的", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: SEED_CARDS });
    expect(prompt).toContain("动作链:");
    expect(prompt).toContain("致意问候+自报身份");
  });

  it("要求 cardMatchBasis 指到具体动作,对不上不硬配", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: SEED_CARDS });
    expect(prompt).toContain("cardMatchBasis");
    expect(prompt).toContain("不要为了完整而硬配一张卡");
    expect(prompt).toContain("指不出具体动作就省略 usedCardId");
  });
});

describe("话术拟人化(p3)", () => {
  it("规则 1 重写为语体契约:转写稿目标、垫字、单数字锚定、允许陈述收尾", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("像电话转写稿,不像打字稿");
    expect(prompt).toContain("垫字(那、呢、嘛、就是、要不)");
    expect(prompt).toContain("每轮最多报一个数字");
    expect(prompt).toContain("锚着客户自己的钱");
    // 不必每轮都以问题收尾:允许陈述留白。
    expect(prompt).toContain("不必每轮都以问题收尾");
    // 办公用语禁令与正面替换成对出现(说人话在前,禁令在后)。
    expect(prompt).toContain("跟您说一声");
    expect(prompt).toContain("同步一下");
  });

  it("称呼规则:年长称阿姨/大姐,其余选定其一,禁斜杠连写", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("「阿姨」或「大姐」");
    expect(prompt).toContain("「先生」「女士」里选定一个");
    expect(prompt).toContain("「先生/女士」这种连写永远不说");
  });

  it("用词跟人生阶段:年长客户说养老金退休金,不说工资", () => {
    const prompt = promptFor(SEED_PERSONA_P02.visible);
    expect(prompt).toContain("说养老金、退休金,不说工资");
    expect(prompt).toContain("上班族才说工资");
  });

  it("系统已知不问客户:画像写明的行内信息当功课,探询只问行外", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("开口前想一下系统");
    expect(prompt).toContain("不拿去问客户");
    expect(prompt).toContain("探询只问系统看不到的");
    expect(prompt).toContain("画像没写的本行信息视同没有");
  });

  it("精简:删掉已由别处承载的指令", () => {
    const prompt = promptFor(P03_VISIBLE);
    // 元数据裁判已独立承担"判断信号→目的→用卡",不再要求每轮心里判断。
    expect(prompt).not.toContain("每轮先在心里判断");
    // 产品事实一节已写"卡外产品信息一律不说",规则区不再重复。
    expect(prompt).not.toMatch(/^\d+\.\s*只使用产品卡内的事实。?$/m);
    // 拒绝计数由 5/6 两条合为一条,只出现一次"第三次拒绝"门槛。
    expect(prompt.match(/累计第三次拒绝/g)).toHaveLength(1);
  });
});

describe("通话逻辑(p4)", () => {
  it("四条钱规律进入经理提示词,单一来源渲染", () => {
    const prompt = promptFor(P03_VISIBLE);
    for (const name of ["钱有地图", "钱有窗口", "钱有惯性", "钱要台阶"]) {
      expect(prompt).toContain(name);
    }
    // 每条规律带"电话里"用法,不是光秃秃的口号。
    expect(prompt.match(/电话里:/g)).toHaveLength(4);
  });

  it("本局事实按规律标注参数角色", () => {
    const prompt = promptFor(P03_VISIBLE);
    expect(prompt).toContain("对着四条规律用这局参数");
    expect(prompt).toContain("摩擦=代报名与资金无须立即转入");
  });

  it("裁判提示词带规律与 logicHint 归因字段", () => {
    const prompt = assembleManagerMetaPrompt({ publishedCards: SEED_CARDS });
    expect(prompt).toContain("通话逻辑(归因 logicHint 用的四条钱规律)");
    expect(prompt).toContain("钱有地图");
    expect(prompt).toContain('"logicHint"');
    expect(prompt).toContain("归不到具体规律就省略");
  });
});
