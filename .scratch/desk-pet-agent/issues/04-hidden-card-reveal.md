# 04 · 桌宠翻隐藏牌

Status: done
Blocked by: 01, 02

揭示判定 Worker 订阅本局 Thread，每轮直接收到事件。判定分三种：客户已说出 → 自动翻牌，并归因到轮次和策略卡；经理问到边上 → 举牌，玩家点翻或藏；无关 → 不动。结算时揭晓未翻的牌并说明经理漏掉的信号。牌桌显示 x/N。demo 适配器用关键词判定。本工单落地 design/01-flow-subtraction.md 第 9 条。

验收：故事 3、4、5、6；隔离测试：经理上下文不含隐藏信息；结算不评价玩家。

## Comments

- 2026-11-04 已完成：`judgeReveal`（src/domain/hidden-reveal.ts，demo 子串匹配：话术与隐藏条目共享 ≥3 字连续片段）+ 隐藏牌排组件 HiddenCards（翻牌 3D 动画、减少动效直切、进度 x/N、举牌时桌宠变 think）+ 结算揭晓（settleHiddenCards，漏掉的信号只说经理）+ 隔离测试（三个内置画像全部 hidden 条目不进经理系统/裁判提示词）。判定与「翻/藏」选择只存客户端（App 按局持有），未接 Agent Worker 订阅 Thread——留待工单 11 换真实模型时接线。
