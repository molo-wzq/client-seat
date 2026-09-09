# 27: 领域错误语义化与 http 契约测试(审计 C5)

**What to build:** 「不存在」与「输入不合法」在领域层带类型,server 统一映射 404/400;把服务端处理抽成可测模块并补真实 http 契约测试。

**Blocked by:** None.

**Status:** ready-for-human

## 用户问题(架构审计 C5)

- 素材归档类型(顺利沟通/软拒绝/明确拒绝)校验已在 core 两处执行(analyzeTranscript 与 updateMaterialDraft),但 server 还在 analyze 路由重复预校验(400),而 PATCH 草稿路径的非法类型由 core throw 走 catch-all 变 500——同一条规则两层错误码;
- 「素材不存在」等语义是 404,却一律回 500;浏览器看到的错误码没有契约保证;
- server/main.ts 零测试(路由、错误映射、body 解析均无覆盖)。

## 改动范围

- 领域:product-core 导出具名错误 `NotFoundError` 与 `ValidationError`(消息不变);素材/通话/画像/策略卡不存在的 throw 改 NotFoundError,素材类型不合法改 ValidationError。
- 服务端:新增 `server/app-server.ts`,导出 `createRequestListener({ core, staticRoot })`(路由、body 解析、静态文件服务、统一错误映射:NotFoundError→404、ValidationError→400、其余→500);main.ts 收薄为组合根(读配置→建 core→listen)。删除 analyze 路由的重复预校验。
- 契约测试(server/app-server.test.ts,真实端口 + fetch):非法素材类型→400;PATCH 草稿非法类型→400;不存在素材/通话→404;未知接口→404;合法 analyze→200。
- UI 侧不改:http 适配器仍把 error 消息抛成 Error,界面行为不变。

## 前后对照验收

- 前:PATCH 非法类型 500、GET 不存在素材 500;analyze 与 PATCH 同规则不同码;server 层无测试。
- 后:非法输入 400、不存在 404,统一由领域错误类型驱动;契约测试钉住全部错误路径;全量测试无回归。

## Comments

- 2026-09-09 已实现:product-core 导出 `NotFoundError`/`ValidationError`(消息不变),素材/通话/画像/策略卡不存在的 throw 改 NotFoundError,素材类型不合法改 ValidationError;新增 `server/app-server.ts`(createRequestListener:路由+解析+静态+统一映射 404/400/500,删除 analyze 路由重复预校验),main.ts 收薄为组合根(读配置→建 core→listen);新增 server/app-server.test.ts 8 条真实端口契约测试(合法分析 200、两路径非法类型 400、不存在素材/通话 404、未知接口 404、快速开始 200)。全量 105 测试通过。待人工验收。
