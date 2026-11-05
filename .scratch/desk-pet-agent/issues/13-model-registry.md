# 13 · 多模型注册表（按角色选模型，可多供应商）

Status: ready-for-agent
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
