# 12: 提升模型 JSON 输出可靠性——降级轮元数据补全

**Type:** task

**What to build:** L2 四段演示出现 6 次纯文本降级(模型未返回 JSON):对话不中断但该轮丢失 usedCardId/信号/目标元数据,结果页策略路径变稀。需降低降级率或为降级轮补一次轻量结构化抽取。

**Blocked by:** None(独立小票).

**Status:** ready-for-human

实现口径见 `l2/demo-conversations-02-05-小结.md` 缺口 2。候选手段:①请求层启用模型的 JSON 输出模式/结构化输出(若网关支持);②降级轮后补一次轻量抽取调用(把已播出的回复文本回读,让模型补 signal/goal/usedCardId);③评估纯文本轮的真实比例,若 <10% 可仅记录不处理。验收:对真实模型的统计性验证(跑 N 轮统计降级率)+ 降级轮补抽取的链路测试(伪实现)。

- [x] 方案选定(JSON 模式支持情况实测决定)。
- [x] 降级率统计基线(真模型 N 轮抽样)记录在案。
- [x] 若走补抽取:链路自动化测试通过,降级轮元数据不再为空。(**条件不成立,本项不适用**:选定方案①,未走补抽取;对话请求已发送 response_format 并有单测护栏。残余风险:JSON 模式非硬保证,极端情况仍可降级,升级路径见 ## Comments)

## Comments

实现说明:实测网关支持 `response_format={"type":"json_object"}`(2/2 次 HTTP 200 且输出可解析),选定口径①:对话请求(generateManagerTurn)发送 response_format,转写分析请求不发送(分析失败本就显式抛错,无静默降级面);纯文本降级路径保留作最后兜底,降级轮补抽取(口径②)无需引入。A/B 统计(各 12 轮,3 画像 × 4 场景,方法与局限见 `l2/json-reliability-baseline.md`):改造前 2/12 降级(16.7%,两处均为「资金话题」长回复场景),改造后 0/12(0.0%);改造前参考基线另有演示记录 4 段 6 次降级(小结缺口 2),量级相符。单测:`src/adapters/openai-model-adapter.test.ts` 断言对话请求携带 response_format、分析请求不携带。

采样中的附带发现:模型偶发输出 usedCardId="无" 之类垃圾值——领域层 `product-core` 的已发布卡校验(`product-core.ts:268-275`)会将其剥除,策略路径不受污染,该不变量已由既有代码保障,本票不改。

工具与记录:`l2/json-reliability-probe.ts`(probe/sample 两模式)、`l2/json-reliability-baseline.md`、`json-reliability-sample-before.json`、`json-reliability-sample-after.json`。样本与方法局限(双轴评审后补记):每组 12 轮为方向性证据(2/12 vs 0/12 无统计显著性),不作「已显著降低」的声明;降级判定用「元数据缺失」宽口径,票面「纯文本降级」为其主要子集;复跑命令:`npx tsx .scratch/phone-coaching-agent/l2/json-reliability-probe.ts sample "复核" [输出文件名]`。

验收记录:业务口径经用户确认通过(2026-09-09)。
