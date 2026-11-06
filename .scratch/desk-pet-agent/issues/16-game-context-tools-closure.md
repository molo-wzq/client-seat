# 16 · 桌宠接入牌局上下文、工具调用与审批闭环

Status: done
Blocked by: 15

## 背景
用户 2026-11-05 18:31 给出一份批评清单（部分基于 PR #10 的旧代码）。截至 PR #11 已解决的部分：工单 11 接入了真实 LLM（main.ts 用 createModelWorkers，无 key 时才退回 demo）；工单 14 加了对话面板、历史与多轮 history。
工单 15 负责解决：通话中不锁输入、对话流替代 40 字气泡（气泡只做通知，全文进面板）、动态建议动作、Agent 轨迹。
本工单解决剩下的问题：上下文缺失、没有工具、伪进度、审批不闭环。

## 定位调整（用户确认）
通话中，玩家主动问的时候，桌宠可以帮玩家（客户方）分析经理的意图、商量怎么回、给可选说法。限制如下：
- 只在玩家问的时候回答，不主动插话；
- 不打分，不评价玩家；
- 不替经理出招；
- 隐藏信息只用来帮玩家推演，绝不进入经理上下文。
这一条替代 v7 里「不教玩家怎么演」的旧规则。

## 做什么
1. **牌局快照**：前端在发 chat trigger 时附带 `context`，内容为：
   - 当前客户角色卡的公开面（姓名、资产偏好、防备心）；
   - 本局玩家自己的隐藏牌（仅客户侧可见）；
   - 最近 6 轮对话，按经理 / 玩家区分；
   - 经理已出的策略卡及其出处；
   - 当前回合数 / 12、已揭示的隐藏牌数 x/N。
   不在牌局时，改为附带当前所处幕（布置 / 复盘）和最近一局的摘要。字段写进 agent-contract.ts（ChatContext），并有长度上限。
2. **隔离**：context 只进入桌宠对话 Worker 的提示词，落账前整个剔除（复用 S4 的剔除机制）。需要测试钉住：经理 Worker 和经理侧任何路径都读不到 context 或 hidden；账本、Report、delta 都不含隐藏牌原文；redact 可注入。
3. **工具调用**：对话 Worker 支持 OpenAI tools / function calling，链路走 failover。只读工具：
   - `get_weekly_research`：本周投研情报卡（情报档案夹的数据源）；
   - `search_cards`：按关键词查策略卡，返回卡面和原始通话片段出处；
   - `get_last_review`：上一局复盘摘要；
   - `get_customer_card`：当前客户公开面。
   不接外网，不查实时利率，回答里不得编造实时数据。工具调用最多 3 轮。无 key 时 demo 用脚本模拟一次工具调用，保证演示可用。
4. **真实进度**：去掉 demo 以外的 sleep 伪进度。Worker 每调用一次工具，发一条 progress 事件（工具名 + 一句中文），供工单 15 的「做了什么」轨迹使用。只有 DemoWorker 允许保留节拍延时。
5. **动态建议**：模型按牌局快照，每轮给出 ≤3 个建议动作（例如「他在探我底？」「帮我想个推托的说法」），并替换工单 15 的建议位。无 key 时 demo 按回合给固定的 2 个。
6. **审批闭环**：
   - 同意投研草稿 → 写入本周投研的异议包（情报档案夹可见，标注「桌宠起草·已审」）；
   - 同意盲区草稿 → 进入策略卡人审队列（仍不直接上牌库，ADR 0007 闸门不变）；
   - 驳回 → 草稿归档，附驳回理由；
   - 每个动作都落账，并在对话里回一句「已放进本周档案夹」。
   需要测试覆盖：同意后数据源里确实出现该草稿。
7. **微反应**：表情由 Worker 根据牌局事件 + 模型输出的表情标签决定（已有 EMOTION_TAG）。牌局事件包括：经理出卡、隐藏牌被问到、玩家揭示。不再只由外部 prop 切换。

## 验收
- 相关单测通过，typecheck 通过，build 通过。
- demo 模式（无 key）下，7 幕和通话中问桌宠都能演示。
- 有隔离测试、工具调用测试、审批闭环测试。

## Comments

- 2026-11-05（ZCode）六步全部完成，分六笔提交（2b65793→3e9f4ae）：
  1. ChatContext 契约（agent-contract，牌局/非牌局两态 + 长度上限）；落账前整个剔除（core 复用 S4 机制，账本无 context/隐藏牌原文）；隔离测试 server/agent/game-context.test.ts 钉住「只进桌宠提示词」。
  2. 前端纯模块 pet-game-context 组装快照（最近 6 轮、用卡出处、x/N 揭示数、非牌局换幕+摘要），App→DeskPet→useChatSession 随 chat 发送。
  3. 只读工具 ×4（get_weekly_research / search_cards / get_last_review / get_customer_card，后三者数据源由 main.ts 注入本地数据）；AgentModelPort 新增非流式 completeWithTools，OpenAI 适配器实现线格式映射、Failover 链整链切换；工具最多 3 轮、每轮一条 progress（工具名+中文）；无 key demo 脚本模拟一次工具调用（tools.test.ts）。真实路径去掉伪进度，仅 DemoWorker 保留节拍。
  4. 动态建议：回复尾行「【建议】a|b|c」由流式闸门扣住不上屏，剥成 quickActions（≤3）替换静态意图表；demo 按回合给固定 2 个；面板建议按钮改为点击即作为对话发出。
  5. 审批闭环（approval.test.ts）：同意投研→写入 current-sections.json 异议包（标注「桌宠起草·已审」，情报档案夹可见）；同意盲区→data/agent/card-review-queue.json 人审队列（无发布接口，ADR 0007 闸门不变）；驳回→归档附理由（决议命令支持可选理由并进审批串行队列）。
  6. 表情事件驱动：新增 table 触发 card-played/hidden-raised/hidden-revealed → Worker 落 dropped+emotion（think/pout/cheer，不出气泡）；复盘 ready Report 带 cheer；App 撤销 expression prop 切换，DeskPet 经 SSE 对非对话工单 Report.emotion 做短时微反应。
- 验证：相关单测全绿；npm run typecheck 0 错误；全量 npx vitest run server src 69 文件 656 测试通过（2 个既有 smoke 门跳过）。未跑 build 与 code-review（按约定由用户验收）。demo 模式链路全程无 key 可演示（demo 对话含模拟工具调用与固定建议）。
