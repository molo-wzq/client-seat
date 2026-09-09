# 18: 进行中对局可找回

**What to build:** 离开对局后,进行中的通话在界面有明确入口可回,不再变成悬挂的孤儿数据。

**Blocked by:** None.

**Status:** ready-for-agent

## 用户问题

用户接通电话进入对局后,点「新对局(布置)」或误触离开,这通进行中的通话就从界面上彻底消失:历史通话列表只显示已结束通话(`src/ui/CatalogViews.tsx:99`),左栏「进行中的通话」按钮只认当前内存里的 session(`src/ui/LeftRail.tsx:32-38`)。`App.openHistory` 里处理 ongoing 的分支(`src/App.tsx:101-104`)永远不可达,通话只能悬挂在 `data/db.json` 里。

## 改动范围

- `HistoryView` 列出 ongoing 通话:带「进行中」徽标,排在已结束条目之前;点击走现有 `openHistory` 的 ongoing 分支回到对局。
- 左栏「进行中的通话」按钮:无内存 session 时,若 catalog 中存在 ongoing 通话,同样可点击回跳(复用 `listConversations` 已返回的 ongoing 数据,不新增端点)。
- 不改领域状态:ongoing/ended 语义不变。

## 前后对照验收

- 前:开一通对局 → 点「新对局(布置)」→ 旧对局在界面上无处可寻。
- 后:同一操作后,历史通话列表顶部可见带「进行中」徽标的条目,点击回到对局原样继续;左栏按钮同样可回跳。
- 自动化:App 层测试覆盖「开新对局后,从历史找回进行中通话并继续」。

## Comments
