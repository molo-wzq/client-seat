# 03 · 命令条 + 快捷环 + 气泡

Status: done
Blocked by: 01, 02

按 Ctrl+K 唤出命令条（打字；按住说话复用现有 ASR），点击桌宠弹出快捷环（换个客户、再来一局、上局复盘、本周投研）。指令发给 Router，回复用气泡显示，硬上限 40 字。demo 模式用脚本回复。对局中命令条置灰。

验收：故事 8、9；Worker 运行期间仍能发出新指令（全双工）。

## Comments

- 2026-11-04：按住说话仅留禁用占位（ASR 后续接入）；agent 客户端在 src/ui/agent-client.ts（可注入 fetch/EventSource），DemoWorker 快捷环 4 条脚本回复，App 以对局状态传 inCall。
