# 02 流式一致性与通话收口兜底(spec C)

Status: done

## 背景

两段式链路(纯话术流式 + 事后元数据)保留,但存在三个具体问题:①流式期间上屏原文,落库后变 `cleanReplyText` 清理版,前后不一致;②模型话术已告别(再见/拜拜)而元数据缺失或判 false 时,系统状态仍是"进行中";③话术流完后等待元数据期间,BusyHint 仍显示"正在思考"。

## 改动

- `src/domain/reply-text.ts`(新):`cleanReplyText` 从适配器移入领域(适配器 re-export 保持兼容);新增 `detectManagerFarewell`——仅当**最后一句**含拜拜/再见/不再打扰/先不打扰时判收口(已知规则的确定性检查,不碰内容语义)。
- `src/domain/product-core.ts`:`appendManagerTurn` 在 `shouldEnd !== true` 且话术告别收口时结束通话(不伪造用卡、不伪造结果摘要,endReason 写明按告别判定);元数据缺失时维持只降级不失败的现状。
- `src/ui/CallStep.tsx`:流式气泡显示 `cleanReplyText(累积文本)`,与落库文本一致;有增量后 BusyHint 切换为"正在核对本轮…";dev 环境记录并输出首字时间与可再次输入时间(含元数据等待)。

## 验收

- 伪适配器 e2e:话术以告别结尾、元数据 shouldEnd=false → 通话结束且 endReason 注明;非告别话术不受影响。
- CallStep 测试:带前缀的流式增量上屏时即被清理。
- 既有流式/重新生成/停止行为不回退。

## Comments

2026-09-29 实施:cleanReplyText 移入 src/domain/reply-text.ts(适配器 re-export 保持兼容);CallStep 流式气泡显示清理后文本,BusyHint 在有增量后切换为"正在核对本轮…";detectManagerFarewell(只认最后一句的明确告别)在 appendManagerTurn 兜底结束通话,endReason 注明按告别判定、不伪造用卡与结果摘要;dev(非测试)环境输出首字/可再次输入计时。测试:adaptive 新增告别兜底正反例,CallStep 新增流式清理一致性用例。

2026-09-29 补充:真模型基线(cross-p01 第三轮)实测到网关偶发把下一轮客户发言续写进同一输出(`user嗯,就一个账户` 另起一行)。已并入 cleanReplyText:剥掉行首 user/assistant(允许无冒号)或 客户/经理(须带冒号)起的尾部续写,句中同词不误伤;单测覆盖实测形态。
