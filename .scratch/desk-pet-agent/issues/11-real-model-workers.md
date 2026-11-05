# 11 · 真实模型 Worker（对话 / 投研 / 盲区）

Status: ready-for-agent
Blocked by: 02, 05, 08

用户 2026-11-05 决定开工。有 key 就走真实模型；没有 key 时退回现有的 demo Worker，保证 demo 模式可以完整演示。

## 要做
- model-config 新增 Agent 分组：AGENT_ROUTER_* 给轻量模型，AGENT_WORKER_* 给强模型。没配就沿用现有 LLM 配置；LLM 也没配就用 demo。走现有的 OpenAI 兼容客户端，不新增依赖。
- **对话 Worker**：新增 source=pet、kind=chat 的 Trigger，data 带 {text, history 最近 N 轮, view 当前页}。
  - 桌宠人格卡（类似 CCv2，写成数据文件）：名字、语气（年轻、轻快、不油腻）、立场（陪客户一方，不评价玩家，不教玩家怎么演）、口头禅上限。
  - 回复会附带一个表情标签（wave/think/cheer/sleepy/pout），并剥离成结构化字段。
  - 流式输出：SSE 新增 delta 事件（ticketId, text 片段），结束时 Report ready。气泡上限 40 字，对话面板显示全文，单条不超过 120 字。
  - 识别出命令意图（换客户、再来一局等）时，转为快捷动作建议，由前端渲染成按钮，不直接执行。
- **投研 Worker**（R3、R4）、**盲区 Worker**（R5）：只产出草稿进入待办（waiting），人审闸门不变（ADR 0007）。
- 模型出错或超时：Report 标记 failed 并写明原因，同时退回 demo 回复，桌宠不卡死。

## 约束
- 隐藏信息只能留在客户侧，不能进入经理 Worker 的上下文。对话 Worker 也不得把隐藏牌原文写进账本里任何可能流向经理的位置（需要测试钉住）。
- 测试一律用假模型端口，不发真实网络请求。
