# 16: 前端棋盘化改版——"对局"式三幕结构

**Type:** feature

**What to build:** 用户对现有线性四步(素材→画像→对话→结果)的整体逻辑不满意,提出借鉴棋盘游戏的前端形态,可拖拽、"酷"。经低保真线框原型(src/ui/wireframe-prototype/,dev 模式 `/?wireframe&variant=A|B|C|D` 可切换,变体 D 为棋盘方向)评审,确定采用**棋盘对练三幕结构**重排前端。

## 已拍板的决策(2026-09-09,与用户逐条确认)

1. **三幕结构取代线性 stepper**:
   - 第 1 幕「布置」:生客名册 → 拖拽画像到「客户席」→ 接通电话;「快速开始」= 默认起手(P01 + 全部已发布卡),不强迫配置;自制素材入口(粘贴转写稿→分析→确认发布)收在本幕侧栏。
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
- 布置幕:画像入座(拖拽 + 点击,点击保可访问性)→ 接通;快速开始 = 现有 `quickStart()`。
- 对局幕:12 格轨道、对话(复用 CallStep 乐观更新/BusyHint)、右侧只读明牌高亮 `usedCardId` + `currentGoal`。
- 结算幕:结果摘要 + 策略路径 + 「回放原文」滚到该轮;「再来一局」回布置。
- 左栏:素材库 / 策略卡 / 历史通话 / 进行中,接真实列表。
- 素材类型字段(顺利沟通/软拒绝/明确拒绝)入库可选在域、UI 必填(默认顺利沟通,与种子一致)。
- L4 挂点两个:布置幕「上传录音」禁用占位;结算幕「播放原声」禁用占位。

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
| `ui/SetupAct.tsx` | 名册 / 客户席 / 桌上已发布卡 / 产品卡 / 自制素材入口 |
| `ui/TableAct.tsx` | 轨道 + 嵌入 CallStep + 明牌 + 画像可见/隐藏 |
| `ui/PostgameAct.tsx` | 包 ResultStep:回放锚点、播放原声占位 |
| `ui/CallStep.tsx` | 增 `onConversationChange`,逻辑不动 |
| `ui/MaterialStep.tsx` | 增素材类型选择;发布不再推进 stepper |
| `ui/PersonaStep.tsx` | 布置幕「修改属性/自定义」复用 |

隐藏牌:用户扮演生客,必须能看到隐藏信息——视觉上做成「扣着但可看」,文案「仅你知情,AI 不可见」,不真正对用户隐藏。

自制素材:布置幕侧栏放精简入口(转写稿 + 类型 + 生成);完整编辑(说话人/分析/卡)在「素材库」。发布后提示「新卡下一局生效」,不自动跳对话。

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
- [x] 布置幕:入座/接通/快速开始/自制素材入口/上传录音占位。
- [x] 对局幕:轨道 + 明牌高亮 + 画像牌。
- [x] 结算幕:回放原文 + 播放原声占位 + 再来一局。
- [x] 素材库/策略卡/历史通话视图。
- [x] 素材类型 UI。
- [x] 端到端与域测试;BusyHint/CallStep 回归。
- [x] CONTEXT.md 词条。

## Comments

- 线框原型:`src/ui/wireframe-prototype/`(throwaway,仅 dev 可见)。四变体:A 工作台双栏、B 首页卡片流、C 单页三区连续、D 棋盘三幕(选定方向)。评审完成后按惯例移 throwaway 分支。
- 用户原话:"因为存在策略卡和画像,同时又有客户的对话节目,可不可以模仿类似棋盘游戏的前端界面,可以拖拽选择,这样会酷很多"。
- 2026-09-09 拆解:域层不新增「本通卡组」之类状态;布置幕是现有用例组合。素材编辑入口 = 布置幕精简摄入 + 左栏素材库完整编辑。拟物留 L5。
- 2026-09-09 实现完成(待人工验收)。线性 stepper 换成左栏 + 三幕。产品缝新增 `listMaterials` / `getMaterial` / `listConversations`;`Material.kind` 入库可选、UI 默认「顺利沟通」。接通 = 入座后 `startConversation`;快速开始仍走 `quickStart()`。L4 挂点两个禁用占位(上传录音/播放原声)。线框原型本轮仍留 `/?wireframe`。`npx vitest run` 67 passed。
