# 16: 前端棋盘化改版——"对局"式三幕结构

**Type:** feature

**What to build:** 用户对现有线性四步(素材→画像→对话→结果)的整体逻辑不满意,提出借鉴棋盘游戏的前端形态,可拖拽、"酷"。经低保真线框原型(src/ui/wireframe-prototype/,dev 模式 `/?wireframe&variant=A|B|C|D` 可切换,变体 D 为棋盘方向)评审,确定采用**棋盘对练三幕结构**重排前端。

## 已拍板的决策(2026-09-09,与用户逐条确认)

1. **三幕结构取代线性 stepper**:
   - 第 1 幕「布置」:生客名册 → 拖拽画像到「客户席」→ 接通电话;「快速开始」= 默认起手(P01 + 全部已发布卡),不强迫配置。素材生产不放在本幕,统一从左栏素材库进入。
   - 第 2 幕「对局」:12 格通话轨道(经理每轮走一格,到底强制收口)、对话流与输入、右侧明牌区(全部已发布策略卡,高亮"经理本轮在用"+当前目的)、画像可见信息朝上/隐藏牌扣着的拟物隐喻。
   - 第 3 幕「结算」:现有结果页游戏化——分项逐条揭晓(结果/主要目标/收口动作),策略路径逐条翻牌,每条可跳回对局现场看原文;「再来一局」回布置幕。
2. **卡组机制否决**(用户 2026-09-09:"不选卡组了"):策略卡维持现有机制——发布即全员上场,AI 自动检索(`product-core.ts` listPublishedCards 口径不变)。布置阶段唯一拖拽动作 = 画像入座。"卡组跟画像走"也不做;将来若做"定向训练"另立票。
3. **对局中的策略卡展示是只读的**:域层数据(usedCardId/recognizedSignal/currentGoal)已有,前端把"本轮在用哪张卡"做成高亮明牌。
4. **全局左栏外壳并入**(用户 2026-09-09 认可):三幕共用常驻左栏(快速开始/进行中通话/新对局/素材库/策略卡/历史通话),语义 = 左栏"我有什么",主区"正在打的这一局"。
5. 借鉴对象(来自已知公开案例,待配额恢复后可补截图细抠):布置=数字桌游 setup(Wingspan/Scythe);对局=Hearthstone 站场+拖牌落子、BGA 轨道 token;结算=Slay the Spire/Wingspan 结算屏(分项逐条揭晓+回放)。

## 与票 15 的关系

票 15 已交付的加载提示(BusyHint)与乐观更新是通用体验基线,改版后保留语义;快速开始入口被三幕结构的"默认起手"吸收。

**Blocked by:** None.

**Status:** ready-for-human

## 实现方案(2026-09-09 拆解)

本轮只做结构与交互,拟物视觉留到 L5 反馈后;现有素样式(ui.css 色板)铺新布局即可。线框原型本轮保留(dev `/?wireframe`),实现验收后再移 throwaway 分支。

### 范围

**做:**
- 全局左栏外壳 + 三幕主区,取代线性 stepper。
- 布置幕:画像入座(拖拽 + 点击,点击保可访问性)→ 接通;快速开始 = 现有 `quickStart()`;不放自制素材入口。
- 对局幕:12 格轨道、对话(复用 CallStep 乐观更新/BusyHint)、右侧只读明牌高亮 `usedCardId` + `currentGoal`。
- 结算幕:结果摘要 + 策略路径 + 「回放原文」滚到该轮;「再来一局」回布置。
- 左栏:素材库 / 策略卡 / 历史通话 / 进行中,接真实列表。
- 素材类型字段(顺利沟通/软拒绝/明确拒绝)入库可选在域、UI 必填(默认顺利沟通,与种子一致)。
- 不为尚未实现的 L4 放禁用占位;录音摄入待 L4 实现时再设计入口。

**不做:**
- 卡组、选卡、卡跟画像走。
- 拟物质感/新配色。
- 流式输出。
- 域层对话逻辑、提示词、发布口径。

### 域层 / 产品缝

现有用例足够驱动三幕(startConversation / quickStart / sendCustomerTurn / getResult / analyze / publish)。左栏缺只读列表:

- `ProductStorage.listConversations()`(FileStorage + InMemoryStorage)。
- `ProductCore` / `ProductApi` 新增:`listMaterials()`、`getMaterial(id)`、`listConversations()`。
- `analyzeTranscript` 入参增加可选 `kind?: MaterialKind`;`Material.kind?`;`MaterialDraftPatch.kind?`。
- `MaterialKind = "顺利沟通" | "软拒绝" | "明确拒绝"`。非法值抛「素材类型不合法」。旧数据缺字段视为未分类,不迁移补值。
- 种子素材 `kind: "顺利沟通"`。
- HTTP:`GET /api/materials`、`GET /api/materials/:id`、`GET /api/conversations`;analyze 的 JSON 体透传 `kind`。

**不改** `listPublishedCards` 内部口径(发布即全员上场)。

### 前端结构

`App` 视图:`setup | table | postgame | materials | cards | history`。默认落地布置幕。

| 文件 | 职责 |
| --- | --- |
| `App.tsx` | 视图状态、左栏回调、快速开始/接通 |
| `ui/LeftRail.tsx` | 常驻导航 |
| `ui/SetupAct.tsx` | 名册 / 客户席 / 桌上已发布卡 / 产品卡 |
| `ui/TableAct.tsx` | 轨道 + 嵌入 CallStep + 明牌 + 画像可见/隐藏 |
| `ui/ResultStep.tsx` | 结算内容、回放文字原文锚点 |
| `ui/CallStep.tsx` | 增 `onConversationChange`,逻辑不动 |
| `ui/MaterialStep.tsx` | 增素材类型选择;发布不再推进 stepper |
| `ui/PersonaStep.tsx` | 布置幕「修改属性/自定义」复用 |

隐藏牌:用户扮演生客,必须能看到隐藏信息——视觉上做成「扣着但可看」,文案「仅你知情,AI 不可见」,不真正对用户隐藏。

素材生产只从左栏「素材库」进入;布置幕不承担转写稿录入、分析或发布。发布后提示「新卡下一局生效」,不自动跳对话。

接通 = `startConversation(seatedPersonaId)`;快速开始不依赖入座。

### 测试

- 域:`listMaterials` / `listConversations` / `kind` 合法与非法 / 缺字段旧数据。
- `App.test.tsx` 闭环改为:素材库发布 → 新对局入座接通 → 喂 → 结算追溯。
- 快速开始仍从左栏一键进对局。
- CallStep 乐观更新、BusyHint 文案、PersonaStep 自定义画像:原测试保持。
- 入座可用点击(不必测 HTML5 DnD)。

### 词条

`CONTEXT.md` 补界面结构:布置 / 对局 / 结算 / 入座 / 明牌。域对象不新增。

### 任务清单

- [x] 域层:列表接口 + 素材类型 + HTTP/存储。
- [x] 左栏外壳,默认落地布置幕。
- [x] 布置幕:入座/接通/快速开始;素材入口已按验收反馈移出。
- [x] 对局幕:轨道 + 明牌高亮 + 画像牌。
- [x] 结算幕:回放文字原文 + 再来一局。
- [x] 素材库/策略卡/历史通话视图。
- [x] 素材类型 UI。
- [x] 端到端与域测试;BusyHint/CallStep 回归。
- [x] CONTEXT.md 词条。

## Comments

- 线框原型:`src/ui/wireframe-prototype/`(throwaway,仅 dev 可见)。四变体:A 工作台双栏、B 首页卡片流、C 单页三区连续、D 棋盘三幕(选定方向)。评审完成后按惯例移 throwaway 分支。
- 用户原话:"因为存在策略卡和画像,同时又有客户的对话节目,可不可以模仿类似棋盘游戏的前端界面,可以拖拽选择,这样会酷很多"。
- 2026-09-09 拆解:域层不新增「本通卡组」之类状态;布置幕是现有用例组合。素材编辑入口 = 布置幕精简摄入 + 左栏素材库完整编辑。拟物留 L5。
- 2026-09-09 实现完成(待人工验收)。线性 stepper 换成左栏 + 三幕。产品缝新增 `listMaterials` / `getMaterial` / `listConversations`;`Material.kind` 入库可选、UI 默认「顺利沟通」。接通 = 入座后 `startConversation`;快速开始仍走 `quickStart()`。线框原型本轮仍留 `/?wireframe`。`npx vitest run` 67 passed。
- 2026-09-09 L4 边界纠偏:用户确认 L4 只做优秀录音便捷摄入,不做原声回放;为保持精简,删除布置幕与结算幕的两个禁用占位。
- 2026-09-09 人工验收通过:三幕与左栏结构通过;前端视觉与拟物设计后续另立工作,不阻塞进入 L4。
- 2026-09-09 后续验收反馈:第 1 幕“自制素材”没有必要,已移除;录音转写因耗时较长撤回前端实现,后续改为后台处理。
- 2026-09-09 原型收敛(用户反馈"低保真原型有几项重复的界面"):评审已结束,D 已实装,删除与 D 重复的 A/B/C 三变体及其样式;D 内重复入口一并去除——布置幕桌面「快速开始(默认起手)」(实机已收敛到左栏一处)、「原型跳幕」按钮组(与左栏导航重复)、画像区"或用默认画像快速开局"文案。原型从"四变体评审稿"收敛为"已实装方向的单一线框参照",导航统一走左栏与实机同构,`?wireframe` 门控不变,`?variant=` 作废、`?phase=` 保留深链。README 两张线框截图已重拍(docs/wireframe-gameplay.png、docs/demo-board.png)。typecheck 通过,vitest 105 passed / 4 skipped。原计划"验收后整目录移 throwaway 分支"暂缓执行:用户要求继续推进该原型。
- 2026-09-09 视觉素材入库:AI 生成概念图「UI 素材库 v1」经用户评审美术方向通过,已入库 docs/design/(概念图 + 设计 token 与组件规格 + AI 瑕疵更正记录),作为本票留下的「拟物质感/新配色」另立工作的视觉基准。README 文档索引已收录。
