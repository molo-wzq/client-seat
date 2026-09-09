# 09: 三段代表性对话演示

**Type:** task

**What to build:** 用真实语言模型(mimo-v2.5)+ 产品当前提示词装配(`src/adapters/prompts.ts`),以 3 个内置画像各录一通完整模拟通话(客户轮次按画像性格脚本化),按 `demo-conversation-01.md` 格式存档三段演示记录,验证"不同生客画像下 AI 能自然推进或体面退出、打法确有差异"。

**Blocked by:** 08: 三画像提取与产品内置.

**Status:** ready-for-human

实现口径见 ADR 0003 决定 4:提示词必须用产品实际在用的装配逻辑(经 `createProductCore` 或直接调 `assembleManagerSystemPrompt`),不用旧版 `l2/manager-prompt.md`;密钥复用 `l1/tools/.env.local`;对话产物属 L2 验证工件,存 `l2/`,不进产品代码。

- [x] 3 段演示对话完成并入库 `l2/`(每段含对话记录、策略路径复盘、画像与素材标注)。
- [x] 每段按画像预期验证:顺利型能推进到下一步;推脱型能降压推进或体面收口;拒绝型能体面退出、不纠缠。
- [x] 三段横向对比结论:不同画像下策略路径确有差异(对应 roadmap L2-01/L2-06 验收)。
- [x] 演示中发现的提示词或策略缺口记录成清单(只记录,不在本票内改产品)。

实现说明:实际录制 4 段——demo-02(P02 阿姨)、demo-03(P03 话少客户)、demo-04(S1 软拒绝·合成)、demo-05(S2 明确拒绝·合成),覆盖三类生客验收;演示脚本 `l2/product-dialogue-demo.ts`(文案口用伪适配器取种子策略卡,对话口用真实模型)。演示发现并修复:推理模型 reasoning_content 兜底(适配器缺陷,附单测)。缺口清单见 `l2/demo-conversations-02-05-小结.md`(规则9执行不稳、JSON 输出可靠性、收口未留渠道)。

## Comments

验收记录:验收通过(用户,2026-09-09):打法认可,缺口清单认同。
