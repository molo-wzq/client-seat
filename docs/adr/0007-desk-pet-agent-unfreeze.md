# 为桌宠 Agent 局部解冻，并在本地 Node 服务内自实现 Super-agent 架构

2026-11-04。状态：已接受，依据用户授权：「我同意解冻，第二个 node，先测试，效果不好再换」。

## 背景

PROJECT-ROADMAP 自 2026-09-09 起冻结 L5 及后续层级，冻结期只做产品打磨，并明确「不为尚未发生的试用预埋复杂架构」。桌宠 Agent（设计稿 `design/03-tavern-keeper.md`，v0–v9）是新功能，超出打磨范围，本 ADR 与上述规定冲突。

## 决定

- **局部解冻**：只为桌宠 Agent 解冻。L5 试用（L5-01 至 L5-04）及 L6/L7 仍保持冻结，恢复条件不变。
- **前端展示优先**：当前主要任务是演示。每张工单先保证 demo 模式（无 key）下完整可见、可点、可演示，真实模型能力后续再补。
- **架构**：借鉴 deepseek-ai/dsh-superagent-prototype 的领域模型（Source → Trigger → Thread → Eval → Ticket/Mandate → Assignment → Worker → Channel），在现有 `server/` Node 服务内自行实现轻量版，不依赖 DSH 运行时。
- **可替换**：先测试。若效果不好，再换成 DSH bundle 或 DeerFlow。为此，Agent 核心不得直接依赖具体编排实现，只通过账本和事件接口与 UI 交互。

## 代价与边界

- 新增一层后台复杂度，与冻结原意相悖。用户已知情并授权。
- 隐藏信息隔离（ADR 0003）不变：桌宠（Router）属于客户侧，可读隐藏信息，但任何内容都不得进入经理会话的上下文。
- 结算不评价扮演客户的用户（CONTEXT），桌宠同样遵守。
- 凡会让经理说出新内容的变更（策略卡、产品事实、投研话术），Agent 只能起草，人工审核后才生效。
