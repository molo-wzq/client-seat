# 05 · 角标 + 待办面板 + 工单进度

Status: done
Blocked by: 01, 02

Report 为 waiting 的工单进入待人决定，桌宠头顶显示数量角标，点开待办面板。桌宠旁可展开工单列表，查看并行进度（进展、等待、就绪、受阻、失败）。

验收：故事 10、11。

## Comments

- 2026-11-04：核心加 onReport 汇报缝（同一工单多次追加 Report）与只读 tickets()（server/agent/tickets.ts 纯折叠，GET /api/agent/tickets）；DemoWorker 分步演示（并行→两条进展→就绪；本周投研→进展→等待拍板，「同意/驳回 [工单号]」唤醒原工单落就绪/放弃），sleep 可注入；UI 头顶 waiting 角标、待办面板（同意/驳回发 Trigger）、可展开工单列表带状态徽标。相关测试 37/37 绿 + typecheck 通过；demo 模式（无 key）可完整演示。
