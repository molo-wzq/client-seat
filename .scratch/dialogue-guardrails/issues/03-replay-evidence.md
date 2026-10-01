# 03 复盘证据链(spec D)

Status: done

## 背景

复盘当前只展示"第N轮·卡名+经理话术+来源",缺客户原话、系统识别信号与经理目的;用卡匹配无法确认时静默消失,而不是如实显示"未确认"。事后 `usedCardId` 是话术生成后的模型匹配,只校验卡 ID 存在——匹配说明与因果证明必须分开。

## 改动

- `src/domain/types.ts` / `ports.ts`:`ManagerTurnOutput` 与 `ConversationTurn` 增 `cardMatchBasis?`(仅当 usedCardId 可用时保留);`Conversation` 增 `promptVersion?`;`ConversationResult.strategyPath` 条目增 `customerText`(本轮客户原话)、`recognizedSignal?`、`currentGoal?`、`matchBasis?`;结果增 `promptVersion?`。
- `src/domain/product-core.ts`:经理轮携带 cardMatchBasis;策略路径条目带上当轮客户原话/信号/目的/匹配依据;结果回填会话的 promptVersion。旧记录缺字段如实为空,不补全。
- `src/ui/ResultStep.tsx`:策略路径改为逐经理轮的复盘链——**客户本轮原话 → 系统识别信号/经理目的(标注为解释候选) → 匹配的策略卡(含匹配依据;无卡或无依据显示"未确认") → 经理实际回应 → 来源轮次**;未匹配卡的经理轮也进列表;无匹配依据/素材缺失/旧记录无版本如实标注。
- 卡内容快照:已发布卡不可修改(编辑接口对 published 抛错),卡 id 即内容快照标识,不另建版本表。

## 验收

- result-explanation 测试:条目含客户原话/信号/目的;匹配依据落库;无卡经理轮在 UI 数据层可见;promptVersion 旧记录为空。
- 不出现评分元素;不把事后匹配表述成模型真实思考过程(用"系统识别(候选)"措辞)。

## Comments

2026-09-29 实施:ManagerTurnOutput/ConversationTurn 增 cardMatchBasis,Conversation 增 promptVersion;策略路径条目带客户原话/识别信号/目的/匹配依据,结果回填 promptVersion;ResultStep 改为逐经理轮复盘链,未匹配卡显示"未确认",无匹配依据显示"匹配依据未记录",旧记录显示未记录提示词版本;已发布卡不可编辑,卡 id 即内容快照,未另建版本表。result-explanation 新增证据链与不硬配断言。
