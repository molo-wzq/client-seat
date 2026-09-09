# 20: 清理撤回入口残留(ADR 0005)

**What to build:** 界面文案与代码不再指向已撤回的「布置幕自制素材」入口;删除相关死代码与重复请求。

**Blocked by:** None.

**Status:** ready-for-agent

## 用户问题

- 素材库空态提示「可在布置幕侧栏粘贴转写稿」(`src/ui/CatalogViews.tsx:22`),但该入口已按 ADR 0005 撤回,是幽灵指引。
- `MaterialStep` 的 compact「自制素材」分支(`src/ui/MaterialStep.tsx:86-158` 相关)已零调用点,是撤回入口的死代码。
- `PersonaStep` 内有永不渲染的「开始接听/保存并开始接听」按钮残留,且自行重复请求 `listPersonas`(`PersonaStep.tsx:36-49`),App 已持有同名数据。

## 改动范围

- 空态文案改为指向素材库自身:「还没有素材。在下方粘贴转写稿开始分析」(或同义)。
- 删除 `MaterialStep` compact 分支及未使用的 props,确认无调用点后同步清理类型。
- `PersonaStep`:删除永不渲染的按钮死代码;personas 改由 props 传入,删除重复的 `listPersonas` 请求;同步调整 `PersonaStep.test.tsx`。
- 不合并「自定义生客与名册的双列表」交互(issue 17 条目 16 另议)。

## 前后对照验收

- 前:空库打开素材库,提示指向不存在的布置幕侧栏。
- 后:提示指向素材库自身的粘贴入口;grep 无 compact「自制素材」残留;全部测试通过。

## Comments
