# 13 · 多模型注册表（按角色选模型，可多供应商）

Status: done
Blocked by: 11

用户 2026-11-05 要求：模型接口预留多模型适配。

## 协议决定（草案，用户未否决前按此做）
- 主协议：**OpenAI Chat Completions**（含 stream SSE、tools / function calling、response_format=json）。国内主流（MiMo、智谱 GLM、DeepSeek、通义/百炼、Kimi、豆包）和本地（vLLM、Ollama）都提供兼容端点，一个适配器就能覆盖。
- 预留：protocol 字段，可选值 openai-chat | anthropic-messages。本期只实现 openai-chat，anthropic-messages 只留接口和一个未实现时的明确报错。
- 不采用 OpenAI Responses API，原因是国内兼容不完整。MCP 是给工具用的协议，不是模型协议，这一期不涉及。

## 要做
- providers：可选的 models.config.json 加 env，例如 { id, protocol, baseUrl, apiKeyEnv, models[], capabilities: {stream, tools, json, audio} }。密钥只从 env 读取，不写进文件。
- roles：manager（经理）、judge、copywriting、asr、agent.router、agent.worker、agent.chat，每个角色配 "providerId:model" 加一条有序的 fallback 链。
- 兼容：现有 MIMO_* / ASR_* / LLM_FALLBACK_* 变量继续有效（映射成默认 provider），旧的 .env.local 不需要改。
- 解析结果是纯函数，带测试；启动时打印每个角色实际用的是哪个 provider:model（不打印密钥）。能力不匹配时直接报错（例如 agent.chat 要求 stream）。
- 现有 FailoverModelAdapter 改成按角色的 fallback 链组装。

Comments: 2026-11-05 新增 server/model-registry.ts:resolveModelRegistry 纯函数(models.config.json 的 providers+roles,文件角色优先;旧 MIMO_*/ASR_*/LLM_FALLBACK_*/AGENT_* 映射成默认 provider,旧 .env.local 不改可用;能力硬校验 agent.*→stream、judge/copywriting→json、asr→audio,不满足即报错;anthropic-messages 被角色引用时报明确「尚未实现」,只登记不引用则预留;密钥只从 env 读,文件 provider 指向的环境变量缺失启动即报错)+formatRegistrySummary 逐角色打印 provider:model 链、不含密钥;FailoverModelAdapter 改链式构造并补 completeStream(仍守「话术已流出不切换」边界);main.ts 按角色组装(manager/copywriting 各自链,judge 链首模型作裁判元数据提取经 OpenAICompatibleModelAdapter 新增可选参数注入,缺省同体现状,agent.chat/agent.worker 链进 workers,链空即 demo);audio-intake 转写与说话人整理改读注册表 asr/copywriting 角色;README 补多模型注册表一节(智谱 GLM+DeepSeek models.config.json 示例,.env.example 不存在故只写 README)。测试缝:注册表解析纯函数 14 例、故障转移链假端口 12 例;只跑相关单测文件与 npm run typecheck,demo 启动与旧变量启动各冒烟一次。
