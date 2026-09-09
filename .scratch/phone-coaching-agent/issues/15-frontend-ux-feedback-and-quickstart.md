# 15: 前端体验改进——加载反馈、操作响应与快速开始

**Type:** task

**What to build:** 2026-09-09 验收活体走查的用户原话:"前端画面和反馈有点差,速度有点慢,不能直接跳过话术去对话"。三个体验问题待拆解:

1. **画面与操作反馈差**——模型调用期间(分析/每轮对话 5–25 秒)缺少加载状态与进度反馈,界面像卡死;
2. **速度慢**——真实模型延迟无法消除,但可通过加载态、乐观更新、(候选)流式输出改善体感;
3. **不能跳过话术直接对话**——想直接练一通电话,必须先走 素材→发布 全流程;缺少「快速开始」入口(用内置画像 + 种子策略直接开一通对话)。

**Blocked by:** None.

**Status:** ready-for-human

原始反馈,需先拆解定方案(例如:①/②是 UI 层 loading 态与文案;③是产品缝新增"快速开始"用例还是仅前端跳转;是否引入流式),再置 ready-for-agent。验收演示复现:验收时真模型走四步,分析约 10–20s、每轮对话约 5–15s,期间无任何加载提示。

## 拆解结论(2026-09-09 triage)

三项全部在本票内实现;**不引入流式**(SSE 改造涉及 adapter/服务/UI 三层,收益不抵复杂度,留作后续候选)。范围限定 UI + 产品缝,不动提示词与对话逻辑。

### ① 加载反馈(UI 层)

现状:`busy` 只禁用按钮,仅 MaterialStep 按钮文案变「分析中…」,其余步骤等待期间界面无提示。

方案:新增共享加载提示组件 `src/ui/BusyHint.tsx`(`role="status"` + `aria-live="polite"`,含旋转指示与说明文案),各步骤在 `busy` 时渲染:

- `MaterialStep`:分析时显示「正在分析转写稿,约需 10–20 秒…」;发布时显示「正在发布策略卡…」,保存时显示「正在保存…」。
- `PersonaStep`:开始接听/保存时显示「正在接通…」。
- `CallStep`:发送后显示「理财经理正在思考…」;`finish()` 时显示「正在生成对练结果…」。
- `App` 快速开始(见③)期间显示「正在准备对话…」。

文案统一约定:说明"正在做什么 + 大致耗时量级",不出现技术名词。

### ② 速度体感:乐观更新(UI 层)

真实模型延迟不可消除,本期只做体感优化:

- `CallStep.send()`:发送时先把客户这条话乐观追加到本地 `conversation.turns`(临时轮次号 = 当前最大轮次号+1)并清空输入框,再 `await api.sendCustomerTurn`,成功后用返回值替换整体;失败回滚到发送前状态并显示错误。
- 不做流式;不改动域层。

### ③ 快速开始(产品缝新增用例)

验收原话"不能直接跳过话术去对话"。方案:**产品缝新增 `quickStart()`**,不是纯前端跳转——因为对话要求存在已发布策略卡,需要域层兜底。

- `ProductApi` 新增 `quickStart(): Promise<Conversation>`;`ProductCore` 实现:若库中无任何已发布策略卡,则把种子素材(SC1–SC3)以已发布态入库;然后用第一个内置画像(SEED_PERSONAS[0],P01)执行 `startConversation`,返回会话。
- `HttpProductApi` 加 `POST /api/quickstart`;`server/main.ts` 加对应路由;`InProcessProductApi` 直通域层。
- `App`:header 区放「快速开始一通对话」按钮(各步骤可见),点击 → busy(`BusyHint`)→ 成功后直接 `setConversationId` + `setStep("call")`。
- 已有已发布卡时 `quickStart` 不得重复入库种子(幂等:按种子素材标题或固定 id 判定)。

### 测试

- UI 测试(参照 `PersonaStep.test.tsx`/`App.test.tsx` 现有模式,用伪 ProductApi):
  - busy 期间渲染对应 BusyHint 文案;
  - 乐观更新:点击发送后客户话立即出现在通话记录,伪 api 失败时回滚并报错;
  - 快速开始:点击后调用 `api.quickStart()` 并跳到对话步。
- 域层测试:`quickStart` 在空库时发布种子卡并开会话;重复调用幂等(不重复入库)。
- 收尾跑 `npm run build` + `npx vitest run`;真模型冒烟非本票必须。

### 验收口径

复现验收走查:分析、发送、结束、快速开始四个等待点均有可见加载提示;发送后自己的话立即上屏;首页可一键直接进对话。

## 任务清单

- [x] 拆解:三项各定实现方案与范围。
- [x] BusyHint 组件 + 四步加载提示接入。
- [x] CallStep 乐观更新(含失败回滚)。
- [x] 产品缝 quickStart:域层 + InProcess + Http + server 路由。
- [x] App 快速开始入口。
- [x] UI 测试与域层测试。
- [x] CONTEXT.md 补「快速开始」词条(triage 已确认引入该领域词)。

## Comments

**2026-09-09 实现完成(待人工验收)**,状态置 `ready-for-human`。

实现要点:
- `src/ui/BusyHint.tsx` + `src/ui/use-busy-task.ts`:忙态三件套(busy/busyHint/error)抽成共享 hook,MaterialStep 与 PersonaStep 复用;CallStep 因乐观更新与 finish 语义不同,保留自带实现。
- 四处等待点提示:素材分析/发布、画像接通、对话思考、结果生成、快速开始。
- CallStep 乐观更新:客户话立即上屏,失败回滚并恢复输入框草稿。
- `quickStart`:`POST /api/quickstart`;空库时种子素材(`SEED_MATERIAL_ID = "seed-c01"`)以已发布态入库,用 P01 画像开会话;按种子标题幂等。
- 测试:域层 4 例(空库兜底/幂等/不重复入库/草稿发布)+ UI 8 例(乐观更新三态、四处 BusyHint 文案、App 快速开始端到端)。`npx vitest run` 61 passed,`npm run typecheck` 与 `npm run build` 通过;`POST /api/quickstart` 已用真服务 curl 冒烟(返回 p01 会话,不重复入库)。

评审记录(双轴 code-review,findings 均已处理):
- Standards:无成文标准违规;busy/busyHint 三处重复 → 提取 `useBusyTask`;`"seed-c01"` 魔法字符串 → `SEED_MATERIAL_ID`。
- Spec:补 MaterialStep/PersonaStep/App 三处 BusyHint 文案断言(`src/ui/busy-hints.test.tsx`);票内文案与乐观轮次号口径已对齐实现。
- 超出 spec 的一处实现(有意保留):种子素材在库但卡为草稿时,`quickStart` 会直接发布其草稿卡——覆盖"种子已在库但未发布"的旧数据情形,有测试护住。

未做(票内已声明范围外):流式输出。真模型端到端冒烟(分析/对话)未在本票重跑,验收走查时可顺带观察四处提示的实际体感。
