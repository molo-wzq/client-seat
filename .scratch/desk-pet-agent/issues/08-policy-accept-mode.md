# 08 · 放权模式 + 评估记录

Status: done
Blocked by: 02, 05

Policy 带版本号，放权模式分 off、observe（默认）、auto。inferred 候选只有在 observe 下才记录「本来会做什么」，在 auto 下才执行。主动规则 R1 到 R7 写进 Policy。管理员可以查看评估记录。

验收：故事 14；切换模式后，再触发同一个 Trigger，结果符合规则。

Comments: 2026-11-05 R1–R7 落成 policy.ts 数据；Eval 分 explicit/inferred，Disposition 进账本即评估记录；GET/PUT /api/agent/policy、GET /api/agent/evals；待办面板顶部三段开关+评估记录。06/07 执行路径改钉在 auto 下。
