# 票 29:对话生成提速——话术流式上屏,元数据二次调用

Status: ready-for-agent

## 背景

对话轮次目前是单次 `chat/completions`(response_format=json_object)整体返回:
用户在模型生成完毕前(推理模型 5–15s)只能看三点思考气泡。
流式输出与严格 JSON 单次输出天然冲突,业界通行做法是拆两次调用。

## 方案

1. **话术调用(流式)**:经理系统提示词的输出规则改为纯文本话术
   (不加 JSON/前缀/旁白),适配器以 SSE 流式读取,`onReplyDelta` 逐段回调;
   content 为空时仍守「思维链不得播出」红线。
2. **元数据调用(json_object)**:话术落地后,第二次小调用做裁判提取
   {signal, goal, usedCardId, shouldEnd, endReason, outcomeSummary}。
   失败/解析失败降级为无元数据一轮(策略卡高亮与自动收口缺失可见,
   但不丢整轮对话——优于现状的单点失败)。
3. **传输**:新增 `POST /api/conversations/:id/turns/stream`(SSE:
   `delta`/`done`/`error` 事件);原 `/turns` 保留不动。
4. **UI**:CallStep 优先走流式接口,话术逐字上屏;接口缺失(测试桩)回退旧路径。

## 改动面

- `src/adapters/prompts.ts`:规则 10 改纯文本输出;新增裁判提示词
- `src/domain/ports.ts` / `product-core.ts`:`generateManagerTurn(input, onReplyDelta?)`;
  ProductCore 增加 `sendCustomerTurnStream`
- `src/adapters/openai-model-adapter.ts`:流式读取 + 元数据二次调用 + 降级
- `src/adapters/fake-model-adapter.ts`:可选回调,整段话术单次回调
- `server/app-server.ts`:SSE 端点
- `src/product/http-product-api.ts`:SSE 客户端解析
- `src/ui/CallStep.tsx`:流式气泡状态
- 测试:adapter 流式/降级、prompts 规则 10、app-server SSE、CallStep 流式 UI

## Comments

## Comments

2026-09-12 完成。实测(mimo-v2.5-pro):思考 8.2s 后首字流式上屏,文本逐段增长
(17→25→32 字符),话术完成后元数据二次调用约 3.7s 异步落地——策略卡高亮、
当前目的、通话轨道均在 done 事件后出现。换回非推理模型后首字延迟会显著下降。

- 142 测试全过(含新增:adapter 两段式/降级 6 例、SSE 端点 2 例、CallStep 流式 1 例、prompts 3 例)
- 原 POST /turns 非流式端点保留,接口契约不变
- 降级路径:元数据调用失败 → 无元数据一轮(console.warn),不丢话术
