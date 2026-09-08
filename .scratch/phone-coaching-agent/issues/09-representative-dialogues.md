# 09: 三段代表性对话演示

**Type:** task

**What to build:** 用真实语言模型(mimo-v2.5)+ 产品当前提示词装配(`src/adapters/prompts.ts`),以 3 个内置画像各录一通完整模拟通话(客户轮次按画像性格脚本化),按 `demo-conversation-01.md` 格式存档三段演示记录,验证"不同生客画像下 AI 能自然推进或体面退出、打法确有差异"。

**Blocked by:** 08: 三画像提取与产品内置.

**Status:** ready-for-agent

实现口径见 ADR 0003 决定 4:提示词必须用产品实际在用的装配逻辑(经 `createProductCore` 或直接调 `assembleManagerSystemPrompt`),不用旧版 `l2/manager-prompt.md`;密钥复用 `l1/tools/.env.local`;对话产物属 L2 验证工件,存 `l2/`,不进产品代码。

- [ ] 3 段演示对话完成并入库 `l2/`(每段含对话记录、策略路径复盘、画像与素材标注)。
- [ ] 每段按画像预期验证:顺利型能推进到下一步;推脱型能降压推进或体面收口;拒绝型能体面退出、不纠缠。
- [ ] 三段横向对比结论:不同画像下策略路径确有差异(对应 roadmap L2-01/L2-06 验收)。
- [ ] 演示中发现的提示词或策略缺口记录成清单(只记录,不在本票内改产品)。
