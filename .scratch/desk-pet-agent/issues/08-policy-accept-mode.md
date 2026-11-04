# 08 · 放权模式 + 评估记录

Status: ready-for-agent
Blocked by: 02, 05

Policy 带版本号，放权模式分 off、observe（默认）、auto。inferred 候选只有在 observe 下才记录「本来会做什么」，在 auto 下才执行。主动规则 R1 到 R7 写进 Policy。管理员可以查看评估记录。

验收：故事 14；切换模式后，再触发同一个 Trigger，结果符合规则。
