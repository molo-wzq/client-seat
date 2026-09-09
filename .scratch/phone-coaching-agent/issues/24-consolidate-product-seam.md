# 24: 产品缝接口合并为单一 ProductCore

**What to build:** 删除 UI/测试面向的重复接口声明,全仓库统一面向 `ProductCore` 一个接口名。

**Blocked by:** None.

**Status:** ready-for-human

## 背景(架构审计 C1)

`src/domain/product-core.ts` 的 `ProductCore` 与 `src/product/product-api.ts` 的 `ProductApi` 文本重复声明同一份 15 方法接口,清单靠人工同步;in-process 适配器只是 `return core`。新增一个读方法要改 5 处(接口×2、实现、http 适配器、server 路由)。「两个名字对应两个将来可能不同的实现」的前提并不存在——server 直接跑 createProductCore。

## 用户问题

- 同一接口两处声明,加新功能必须两处同步,漏改即漂移(2026-09-09 左栏计数口径漂移同源);
- 「演示模式标识」等界面信息曾因接口改动成本被降级为文档。

## 改动范围

- 删除 `src/product/product-api.ts`;接口与实现统一保留在 `ProductCore`(domain/product-core.ts),其既有方法级注释即文档。
- UI、测试、适配器共 21 个文件 / 58 处 `ProductApi` 引用机械替换为 `ProductCore`,import 来源改为 `../domain/product-core` 等。
- 产品缝说明(UI 只依赖接口;in-process 供测试、http 供浏览器)移到 `http-product-api.ts` 顶部。
- 纯结构收敛:不新增方法、不改行为、不移动适配器文件。

## 前后对照验收

- 前:两份相同接口,加读方法改 5 处。
- 后:接口只剩一份;typecheck 通过(全部调用点已指向唯一接口);全量测试无回归(行为零变化)。
- 关联:模型按端口拆分(票 25)与后续 C4/C7 都落在这份唯一接口上。

## Comments

- 2026-09-09 已实现(grilling 推荐方案):删除 `src/product/product-api.ts`;21 文件 58 处 `ProductApi` 引用统一改为 `ProductCore`(import 来源全部指向 `domain/product-core`);适配器工厂函数随机械改名(`createHttpProductCore` / `createInProcessProductCore`);产品缝说明移到 http-product-api.ts 顶部。typecheck(前端+server)与全量 78 测试通过,行为零变化。待人工验收。
