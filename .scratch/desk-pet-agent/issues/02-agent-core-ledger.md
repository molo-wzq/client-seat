# 02 · Agent 核心骨架 + 账本 + SSE（tracer bullet）

Status: done
Blocked by: 无

server 内实现最小链路：Source → Trigger → Thread → Eval（只做准入）→ Ticket → demo Worker → Report → Channel。账本只追加，接入 storage-contract；新增 SSE 端点，把 Report 和 Channel 推给前端。编排层只暴露 emitTrigger / subscribe / ledger 三个接口，日后可整体替换。

验收：给定一条 pet 命令 Trigger，账本中依次出现 Trigger、Decision、Ticket、Report，前端能通过 SSE 收到；测试覆盖。

## Comments

- 2026-11-04 实施完成：server/agent/{types,core,storage}.ts，账本接入 storage-contract（InMemory/file-store），POST /api/agent/triggers 和 GET /api/agent/events（SSE）。demo Worker 是确定性脚本；Eval 本期只做准入（pet 命令不能是空文本），kind 只支持 command，后续工单再扩。ZCode 写完代码，Hark 验收并提交。
