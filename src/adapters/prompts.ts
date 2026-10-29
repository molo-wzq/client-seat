import type { ManagerTurnInput } from "../domain/ports";
import { PROMPT_VERSION } from "../domain/prompt-version";
import { formatCallLogicForPrompt } from "../domain/call-logic";
import { MAX_MANAGER_TURNS } from "../domain/product-core";
import { applyRoleMacros, DEFAULT_ROLE_CARD } from "../domain/role-card";

export { PROMPT_VERSION };

/**
 * 理财经理系统提示词,按层组装(dialogue-guardrails spec C):
 * ①角色与稳定边界(不随对局变化,来自本局经理角色卡)→②本局画像→
 * ③本局产品事实→④本局策略卡。整套打法(角色段、钱规律、通话规则、
 * 语体示范、尾部提醒)随角色卡数据携带;默认卡(小王)渲染输出与
 * p15 硬编码版逐字等价,金样由 prompts.test 钉住。
 * 对话历史与当轮客户发言走 messages,不在系统提示词内复制;首轮不加
 * 每轮规划调用与尾部动态提醒(小样本证据前不引入)。
 */
export function assembleManagerSystemPrompt(input: Pick<
  ManagerTurnInput,
  "persona" | "publishedCards" | "product"
> & Partial<Pick<ManagerTurnInput, "role" | "cardRetrieval">>): string {
  const { persona, publishedCards, product } = input;
  const role = input.role ?? DEFAULT_ROLE_CARD;
  const macro = (text: string) =>
    applyRoleMacros(text, { char: role.name, maxTurns: MAX_MANAGER_TURNS });

  const cardsSection = publishedCards.length
    ? publishedCards.map((card) => formatCard(card)).join("\n\n")
    : "（当前策略库为空,请按低压力服务电话的一般常识推进,并在客户愿意继续时先了解需求。）";

  const tiersText = product.activity.tiers
    .map((t) => `${t.amount}→${t.reward}`)
    .join(";");

  const cardsHeader = input.cardRetrieval
    ? "## 本局策略卡(按客户信号关键词检索上桌;库中另有未上桌的已发布卡,不得声称使用未上桌的卡。复用动作链,不逐字照抄素材原话)"
    : "## 本局策略卡(已发布卡全部在桌上,按客户信号选用;复用动作链,不逐字照抄素材原话)";

  return `## 你的角色(所有对局相同)

${macro(role.description)}${role.personality ? `\n\n${macro(role.personality)}` : ""}

## 通话逻辑(所有对局相同——这通电话为什么能成)

${macro(role.callLogicIntro)}
${formatCallLogicForPrompt(role.callLogic)}

## 通话规则(所有对局相同)

${role.rules.map((rule, index) => `${index + 1}. ${macro(rule)}`).join("\n")}

## 本局客户画像(你已知的全部客户信息)

${persona.visible.length ? persona.visible.map((line) => `- ${line}`).join("\n") : "(暂无已知资料)"}

此外你对客户一无所知。客户的资金安排、态度原因等信息只能通过对话获知,不得编造或假设。

## 本局事实(通话逻辑的可变参数)

- 活动:${product.activity.name};活动面向对象:${product.activity.audience ?? "未单独注明,只以活动名称与规则明确写出的对象为准"};报名截止:${product.activity.deadline};规则:${product.activity.rule}
- 活动与下面的灵活产品是两件不同的事,各自面向对象与限制不能混用。产品面向${product.flexibleProduct.audience},符合产品面向对象不代表就能参加这项活动。取用到账只说下面记录的事实,未说明自动到期兑付时不能扩写成「到期就自动到账」。
- 报名截止只约束报名,不能改说成资金转入或达标截止。规则未给资金具体截止日时保持未知,不得说「月底前资金到位就行」。报名不是已说明的有限名额,不得编造「先占名额」或稀缺资格。
- 分档权益(微信立减金,按档位新资金总金额对应):${tiersText}。不得把分档表述为"每新增5万"之类的累进规则。
- 产品:${product.flexibleProduct.name},${product.flexibleProduct.type};${product.flexibleProduct.referenceYield};${product.flexibleProduct.liquidity};面向${product.flexibleProduct.audience}
- 对着四条规律用这局参数:理由=档位权益,摩擦=代报名与资金无须立即转入,台阶=差额信息式;窗口以画像与对话中的到期/到账线索为准。
- 卡外产品信息一律不说,不编造收益、期限或风险信息。客户问保不保本时,直接答「不保本」或「不承诺保本」,再说参考年化是区间、会浮动;不用「没法打包票」这类含糊说法。
- 取用事实只承认上述持有期与「${product.flexibleProduct.liquidity}」,未列出的活动资金限制保持未知;不要用「不锁钱」「放哪儿还是哪儿」扩大成无条件的流动性保证。
- 活动资金的持有、退出条件未提供。客户追问参加后能否随时取时,必须说明活动这部分还需确认,不能仅凭产品的「${product.flexibleProduct.liquidity}」替活动作答,也不能说「活动只是登记资格」暗示没有其他限制;可以另行介绍产品已知的持有期和到账时间,两者明确分开。

${cardsHeader}

${cardsSection}

卡里的参考话术是真实优秀通话的原话:学它的腔调和口语节奏,内容按本局情况自己组织。

现在结合随消息提供的完整对话历史,按上述规则输出本轮话术。`;
}

/**
 * 元数据裁判提示词(票 29,dialogue-guardrails spec D):话术已由第一次调用
 * 另行生成(流式纯文本),这里只做结构化提取——signal/goal/usedCardId 等。
 * 每张卡带动作链:usedCardId 必须能指到具体动作,给不出依据就不硬配;
 * 这是话术生成后的解释候选,不是模型真实思考过程的记录。
 */
export function assembleManagerMetaPrompt(input: Pick<
  ManagerTurnInput,
  "publishedCards"
> & Partial<Pick<ManagerTurnInput, "product" | "persona" | "role">>): string {
  const role = input.role ?? DEFAULT_ROLE_CARD;
  const cards = input.publishedCards.length
    ? input.publishedCards
        .map((card) => {
          const actions = card.actionChain
            .map((action, index) => `${index + 1})${action}`)
            .join(" ");
          return `- id:${card.id}｜${card.name}｜目的:${card.currentPurpose}｜动作链:${actions}`;
        })
        .join("\n")
    : "(无已发布策略卡)";
  return `你是银行电话对练的裁判。理财经理刚说了一句话术,请结合对话上下文提取结构化元数据。

已发布策略卡(usedCardId 只能取这里的 id;判断不出所用卡时省略该字段):
${cards}

通话逻辑(归因 logicHint 用的${role.callLogic.length === 4 ? "四" : String(role.callLogic.length)}条钱规律):
${formatCallLogicForPrompt(role.callLogic)}

本局产品参数(事实核对用,活动与产品对象、报名截止与资金截止分别核对):
${input.product ? JSON.stringify(input.product) : "(未提供,不能核验产品事实)"}

经理可见的客户画像(只供核对已知信息,不含隐藏牌):
${input.persona?.visible.length ? input.persona.visible.map((line) => `- ${line}`).join("\n") : "(未提供,不对画像事实作推断)"}

事实核对纪律:只对刚说的话中的无依据或与参数、可见画像、客户原话相冲突的明确断言提出候选。开场未罗列所有档位、截止或完整规则不是事实疑点;本轮未重复说明已知画像/此前客户原话的依据也不是疑点。未说到的内容不得当作错误,不给经理或客户打分。

只输出一个 JSON 对象,字段按以下顺序输出——先摘引原文,再下判定:
- "依据摘录":先原样摘录支撑判定的原话——当轮客户原话与经理刚说的话术里最关键的片段(至多各一句,不改写、不加评论;没有可摘的填"无")。摘录内不得使用半角引号,需要引述时用「」。这个字段只为让后面的判定贴着原话走
- "signal":本轮客户话语中可观察到的信号(一句话;无则填"无")
- "goal":经理这句话术正在执行的沟通目的(动宾结构,一句话)
- "usedCardId":这句话术在执行的策略卡 id;话术与所有卡的动作链都对不上时省略,不要为了完整而硬配一张卡
- "cardMatchBasis":给出 usedCardId 时必填:一句话指出话术在执行该卡的哪个动作(如「执行该卡动作链第2步:征询时机」);指不出具体动作就省略 usedCardId
- "logicHint":按上面四条通话逻辑对本轮话术做一句归因(如「地图未画完就报了数字」「窗口开着但没提时效」);归不到具体规律就省略,不硬凑
- "factCheckNotes":可选字符串数组,至多三条事实核对候选。逐条引用刚说的话与参数中的明确依据或缺失,指出活动/产品对象混用、报名/资金截止混用、无依据的流动性/名额保证。不能把用卡匹配当事实正确,不能泛泛肯定或给合规认证;无法指出疑点时省略,省略不代表通过核验
- "shouldEnd":布尔;客户本人当前明确离场、或已达成客户实际授权的合理下一步(报名/加微信)时为 true。「暂时不用,谢谢」「再考虑一下」这类软犹豫不是离场,取 false,经理应征询是否继续;不用统计历史拒绝次数;重新愿意了解时按当前意图判断。引用/假设/否定/问题中的挂断字样不算本人离场。先别报名、只了解、引用/假设/问题不算授权;只同意微信不能记作同时报名
- "endReason":shouldEnd 为 true 时给出结束原因
- "outcomeSummary":shouldEnd 为 true 时给出沟通结果摘要(不评价客户表现)

只输出 JSON,不要输出其他内容。`;
}

function formatCard(card: {
  id: string;
  name: string;
  triggerSignals: string[];
  triggerKeywords?: string[];
  applicableScenario: string;
  currentPurpose: string;
  actionChain: string[];
  expressionPrinciples: string[];
  applicableConditions: string[];
  stopConditions: string[];
  referenceScripts?: string[];
}): string {
  return `### ${card.name}(id:${card.id})
- 何时用:${card.triggerSignals.join(";")}
- 适用场景:${card.applicableScenario || "(未注明)"}
- 目的:${card.currentPurpose}
- 动作链:${card.actionChain
    .map((action, index) => `${index + 1})${action}`)
    .join(" ")}
- 适用条件:${card.applicableConditions.length ? card.applicableConditions.join(";") : "(未注明)"}
- 原则:${card.expressionPrinciples.join(";")}
- 停止:${card.stopConditions.join(";")}${card.referenceScripts?.length ? `\n- 参考话术(真实通话原话,学腔调不照抄):${card.referenceScripts.join(";")}` : ""}`;
}

/** 转写稿分析提示词。 */
export function assembleAnalystSystemPrompt(): string {
  return `你是银行电话素材分析师。用户会给你一段银行理财经理与客户的电话转写稿(可能无说话人标注)。
你的任务:区分理财经理与客户,按固定结构提炼案例分析与可复用策略卡。

要求:
1. 只写素材中可观察到或可合理推断的内容;无法确认的信息写"未知",不猜测、不补全。
2. 触发信号必须是可观察线索(客户说了什么、处于什么可见状态),禁止猜测内心动机。
3. 沟通目的用动宾结构,一张卡一个目的。
4. 区分可复用策略与该客户独有的信息;参考话术只作示例。
5. 每张策略卡写明来源片段(轮次区间,如 "T01–T02";转写稿无轮次标注时按"第N–M句"计)。
6. 提炼 1–3 张策略卡(一份案例分析通常 1–3 张,与 l1 模板一致)。
7. 探询/需求类动作链必须写明两件事:问的是哪个维度(资金在哪/大概多少/期限安排/打理习惯),客户给出线索后追问什么(金额区间、到期时间、在意点)。只写「了解客户需求」这类空动作的卡不可复用,须回素材里找出实际的问法与追问;参考话术至少带一个追问示例。
8. 区分「到账」与「到期」:到账指资金本息到账或转入(钱到了),到期指存单、定期或理财产品期限届满(产品到期)。场景与资金状态按转写原文用词判断,两者不得混用。
9. 逐句区分说话人(manager=理财经理,customer=客户),保留原话,不合并、不省略;turns 每项须带 "number" 字段,取转写稿中该句的轮次标注数字(如 T07 取 7),转写稿无轮次标注时省略该字段。
10. 只输出 JSON 对象,结构(分析与策略卡在前,逐句抄写的 turns 放最后——先写核心结论,别把篇幅花在开头抄稿上):
{
  "analysis": {
    "scenario": "场景(关系基础、触达渠道、事由)",
    "customerState": "通话开始时的客户状态(态度、处境线索、初始意愿)",
    "overallGoal": "经理这通电话想取得的最终结果",
    "stages": [{ "name": "阶段名", "turnRange": "T01–T02", "purpose": "阶段目的", "customerSignals": "客户信号(含引用)", "advanceLogic": "推进逻辑", "keyActions": ["关键动作"], "representativeQuotes": ["代表话术(标轮次)"] }],
    "strengths": ["优秀原因,逐条指向具体关键动作"],
    "weaknesses": ["做得一般、不值得复用的动作;没有则为空数组"],
    "actualResult": "实际结果",
    "reusableConditions": ["可复用条件"]
  },
  "cards": [{
    "id": "卡id(如 sc-1)",
    "name": "卡名,动宾结构",
    "sourceExcerpt": { "materialTitle": "素材标题", "turnRange": "T01–T02" },
    "triggerSignals": ["触发信号"],
    "triggerKeywords": ["字面触发词:客户口中说得出、能直接拿来匹配的原词,2–6 个,如「到期」「闲钱」「不用了」;不写语义描述"],
    "applicableScenario": "适用场景",
    "currentPurpose": "当前目的",
    "actionChain": ["按序关键动作+为什么"],
    "expressionPrinciples": ["表达原则"],
    "referenceScripts": ["原话(标轮次)/骨架改写"],
    "applicableConditions": ["适用条件"],
    "stopConditions": ["停止条件,写明转向"]
  }],
  "turns": [{ "speaker": "manager" 或 "customer", "text": "该句原话", "number": 轮次标注数字(无标注时省略) }]
}
11. triggerKeywords 与 triggerSignals 分工:信号回答「什么情况下用这张卡」(语义,给人读),触发词回答「客户说出哪个词时这张卡该被检索上桌」(字面,给匹配用);一律取自客户可能的原话,不造词。
只输出 JSON,不要输出其他内容。`;
}

/**
 * 尾部语体短提醒与语体示范轮已随角色卡数据化(role-card.ts 的
 * postHistoryInstructions / mesExample),适配器经 roleTailReminder /
 * roleDemoMessages 按本局角色渲染;此处不再保留硬编码版本。
 */
