# 04 · 桌宠翻隐藏牌

Status: done
Blocked by: 01, 02

揭示判定 Worker 订阅本局 Thread，每轮直接收到事件。判定分三种：客户已说出 → 自动翻牌，并归因到轮次和策略卡；经理问到边上 → 举牌，玩家点翻或藏；无关 → 不动。结算时揭晓未翻的牌并说明经理漏掉的信号。牌桌显示 x/N。demo 适配器用关键词判定。本工单落地 design/01-flow-subtraction.md 第 9 条。

验收：故事 3、4、5、6；隔离测试：经理上下文不含隐藏信息；结算不评价玩家。

## Comments

- 2026-11-04 已完成：`judgeReveal`（src/domain/hidden-reveal.ts，demo 子串匹配：话术与隐藏条目共享 ≥3 字连续片段）+ 隐藏牌排组件 HiddenCards（翻牌 3D 动画、减少动效直切、进度 x/N、举牌时桌宠变 think）+ 结算揭晓（settleHiddenCards，漏掉的信号只说经理）+ 隔离测试（三个内置画像全部 hidden 条目不进经理系统/裁判提示词）。判定与「翻/藏」选择只存客户端（App 按局持有），未接 Agent Worker 订阅 Thread——留待工单 11 换真实模型时接线。
- 2026-11-11 方案 B 降级：对局桌面撤下扣牌排与「翻 / 先藏着」举牌。原因：玩家在牌桌上看不到自己的牌（只有布置幕折叠区可看），却被要求决定透露与否；经理提示词没有了解客户的维度清单，问出全靠碰巧，玩法空转。现状：隐藏信息作为「你的底细 · 经理看不到」在布置幕与牌桌常驻展示；结算改为「经理问出了哪些底细」，沿用 `settleHiddenCards`（choices 缺省为空，问到边上未说出一律记 edge）；App 不再发 `hidden-raised` / `hidden-revealed` 触发。保留未删：`HiddenCards` 组件与 `PetDemoConsole` 演示场景、`agent-contract` 与 `pet-reactions` 中的 hidden-* 事件类型，待确认不走方案 A 后再清理。方案 A（隐藏信息结构化为维度/事实/松口条件 + 经理 KYC 维度清单 + 按维度判定 + 复盘覆盖率）留作后续。
