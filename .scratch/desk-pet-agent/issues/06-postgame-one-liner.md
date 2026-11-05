# 06 · 对局后复盘一句话（投机执行 R1）

Status: done
Blocked by: 02, 04

对局结束这个 Trigger 会触发复盘 Worker，后台起草「经理哪招值得学」和「没翻开的牌为什么没翻开」，可交付时才在结算页插槽和气泡里出现，没什么值得说就保持沉默。

验收：故事 7；无内容时不出气泡。

## Comments

- 2026-11-04：核心新增 kind=game-ended（Eval 须带对局号与轮次，Thread 按 gameId 归并）；DemoWorker 复盘脚本确定性起草「第 N 轮先接住话头再往下谈，这招值得学」（≤40 字、只评经理，ready Report 附 basis 轮次+卡），无用卡轮落 dropped 且不推气泡（dropped=沉默）；前端 agent-client 加 sendTrigger（返回 EmitOutcome），App 在进入结算（onFinished/openHistory）自动发 table/game-ended（带各轮 managerText+cardId 与未翻开隐藏牌数，按局去重），ResultStep 新增「桌宠复盘」插槽（展开依据：轮次+策略卡），桌宠进结算表情变 cheer。相关测试 58/58 绿 + typecheck 通过；demo 模式（无 key）确定性可完整演示。

