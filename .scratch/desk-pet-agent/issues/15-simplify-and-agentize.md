# 15 · 桌宠交互精简与 Agent 化（含前端审查修复与 DeskPet 拆分）

Status: done
Blocked by: 14

## 背景
用户反馈：选项繁琐，要精简；对话要更方便；突出 Agent 概念（2026-11-05，方案与决定见下）。同时修复前端代码审查发现的问题，审查报告：`/workspace/projects/c994bd2e-f033-4ede-954f-5bd5dc358ece/work/review-desk-pet-frontend.md`。

## 做什么
1. 去掉头像下的常驻按钮（切换男女 / 待办 / 工单 / 勿扰），只保留头像和角标。切换男女、勿扰、放权移到面板右上角「⋯」菜单，右键头像也能打开这个菜单。
2. 只保留一个面板，以对话为主体。删除独立的待办面板和工单列表浮层。
3. waiting 工单以「待拍板卡」的形式插入对话流，卡片上有「同意」「驳回」按钮。卡片被选中（点击卡片或「改一改」）时，输入框上方显示引用条，此时发出的话作为该工单的批注；删除批注表单。点击角标时打开面板，并滚动到最早一张待拍板卡。blocked 工单以只读提示卡显示原因。
4. Agent 轨迹：每条桌宠回复上方加一行可折叠的「做了什么」，例如「🔍 查了本周投研 → 📋 起草工单 → ⏸ 等你拍板」。数据来自账本里同一 trigger 的工单状态变化和评估记录（Worker 名、规则 id、结果），展开后显示明细。如果现有契约给不出数据，在 agent-contract.ts 增加最小字段，服务端补上。
5. 面板顶部是 Agent 状态条。左侧显示「在听 / 在想 / 在跑 N 件事」；右侧是放权两档开关：「只听我的」（off）⇄「主动办」（auto）。observe 只在「⋯」菜单里出现，演示第⑦幕仍然用它。点击状态条展开「工作日志」，按时间线合并显示工单和评估记录。人审闸门不受影响。
6. 对话便利：
   - 删除 4 个固定芯片。空对话时显示 2 个开场建议，之后只显示模型本轮给出的建议动作。
   - 输入 `/` 弹出命令补全：/投研、/复盘、/换客户、/再来一局，支持键盘上下选择和 Enter 确认。
   - Ctrl+K 全局唤起面板（不抢 ⌘K）。
   - 文件拖到头像或面板上，作为附件消息进入对话。
   - 回复里提到的工单可以点击，点击后在工作日志中定位到该工单。
7. 通话中：输入框**不再锁定**，可以和桌宠打字（桌宠站在客户一侧，消息不进经理上下文，必须有测试钉住）。桌宠在通话中不主动弹出面板，也不主动出气泡。表情反应照常。
8. 演示（?demo=pet 7 幕）：面板只跟 focusPanel 开关，演示代发不写 chatOpen；演示表情优先级最高；焦点离开时清掉对话表情。原来指向 inbox / tickets 的焦点改为对话流里的卡片和工作日志。7 幕必须完整可演示。

## 前端审查必须修复
B1、B2，S1–S10 全部修复。建议项修 R1（存储节流）、R3、R4、R5（读屏只播报定稿）、R8、R9、R10、R11。

## 拆分（耦合）
按顺序：
1. 纯逻辑放进模块并补单测，包括：历史读写与校验截断、表情优先级、delta 拼接与定稿、轨迹归并、/ 命令解析。消除 pet-reactions 对 DeskPet 的反向依赖，PetExpression 统一使用契约里的 PetEmotion。
2. 抽出 `useChatSession`、`usePetMood` 两个 hook。
3. 抽出展示组件：PetChatPanel、TicketCard、AgentStatusBar、WorkLog、PetMenu。
4. App 改为通过一个窄接口驱动 DeskPet（命令对象或 ref handle：openPanel / sendAsUser / react / refreshPolicy），去掉 nonce 和计数器式 props；PetChatPanel 不再识别「演示」命令词。

目标：DeskPet.tsx 控制在 300 行以内。

## 视觉
沿用 docs/design/ui-asset-library-v1.md 的 token 和 docs/design/desk-pet/README.md 形象规范：卡纸面板、黄铜回形针、深绿状态条。轨迹行用小号字、卡纸淡色，不抢正文。

## 验收
- 相关单测通过，typecheck 通过。
- 7 幕演示完整可用（测试覆盖）。
- 中文输入法组字时按 Enter 不发送（测试覆盖）。
- 通话中消息不进经理侧（测试覆盖）。

## Comments

- 2026-11-05 阶段 3 完成（cc55790→008be54 共 6 个小提交），Status 置 done。实现：Agent 轨迹行（buildTraceSteps 归并 Worker/评估，回复上方可折叠「做了什么」+「看工单」定位工作日志高亮）；/ 命令补全（上下选择、Enter 确认、Esc 只关补全，手输整句命令同样执行）；Ctrl+K 收口（只认 Ctrl 不抢 ⌘K、勿扰时忽略）；拖入文件作为「📎 文件名」附件消息进对话流；删 4 个固定芯片、空对话给 2 个开场建议；演示 7 幕焦点改为对话流待拍板卡与工作日志（DemoFocusPanel 改 chat/todo/log/none，App 经 DeskPetHandle 窄接口定位）。审查项 R3/R4/R9/R11 已修（R1/R5/R8/R10 此前已修）；顺手给 openPanel 定位滚动加了 scrollIntoView 可选调用守卫，清掉 jsdom 下 4 个未处理错误。账本视图：SSE 报告先乐观落视图，再拉一次 tickets() 用 mergeTicketViews 原位合并补 Worker 名/触发号（轨迹行数据源）。验收：npx vitest run src/ui 28 文件 214 用例全过、npm run typecheck 通过；demo 7 幕经 PetDemoConsole/DeskPet 测试覆盖。备注：DeskPet.tsx 现 391 行，仍高于 300 行目标，剩余为事件路由与命令接口接线，可在后续工单继续下沉。
