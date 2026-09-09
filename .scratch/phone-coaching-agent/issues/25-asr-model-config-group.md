# 25: 转写模型配置独立成组(为双模型对接铺路)

**What to build:** 转写(ASR)与对话(LLM)的模型配置可以各自独立填写;只配一组时行为与现在完全一致。

**Blocked by:** None.

**Status:** ready-for-agent

## 用户问题(架构审计会话确认)

后续准备让「转录模型」与「对话模型」分别对接(可能换不同供应商):现状 `.env.local` 中 key/baseUrl 共用 `MIMO_*` 一组,只有 model 分开(`MIMO_ASR_MODEL`);转写 CLI 若换供应商必须改写代码。

## 现状事实

- 对话/文案分析与说话人整理用 LLM:`MIMO_API_KEY` / `MIMO_BASE_URL` / `MIMO_MODEL`(server/main.ts、audio-intake.ts diarizer);
- 转写用 ASR:`MIMO_ASR_MODEL` 已独立(audio-intake.ts transcriber),但 key/baseUrl 仍回落到 LLM 组;
- 转写不进产品缝(ADR 0005:CLI + 人工校对),因此双模型只影响组合根与配置,领域与 UI 零改动。

## 改动范围

- 新增 `server/model-config.ts`:纯函数从环境变量解析两组配置——LLM 组(变量名不变)与 ASR 组(`ASR_API_KEY` / `ASR_BASE_URL` / `ASR_MODEL`),ASR 组未填时回退到 LLM 组(同一家只需配一组);含默认 baseUrl/model,语义与现有一致。
- `server/audio-intake.ts` main() 改用 ASR 组解析结果;`server/main.ts` 改用 LLM 组解析结果(行为不变,消除组合根手拼 env)。
- 为解析函数补单测(单测组填满 / 只填 LLM 组 / 只填 ASR 组 / 全空报错四态)。
- README「快速体验」环境变量示例更新:说明两组变量与回退关系,不展示 .env.local 实际值。
- 说话人整理(diarizer)继续用 LLM 组,在代码注释与 README 中说明原因(整理是文本任务)。

## 前后对照验收

- 前:同一家时可用;换 ASR 供应商需改代码。
- 后:填 `ASR_API_KEY/ASR_BASE_URL/ASR_MODEL` 即切转写供应商,LLM 组不动;只填 `MIMO_*` 时行为与现在逐字节一致;契约单测覆盖四态。

## Comments
