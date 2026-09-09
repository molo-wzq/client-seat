# 26: 存储适配器语义契约化(审计 C2)

**What to build:** 两个 ProductStorage 适配器行为一致:读返回快照拷贝、写串行化且原子落盘;契约测试参数化约束两个适配器。

**Blocked by:** None.

**Status:** ready-for-human

## 用户问题(架构审计 C2)

- `InMemoryStorage`(测试)每次读写 `structuredClone`,改返回值不污染仓库;
- `FileStorage`(生产,server/file-store.ts)返回内部 Map 活引用、整文件无锁直接 `writeFile`——调用方改返回值会污染仓库,并发两次保存可能交叠写坏文件;
- 同一接口两种语义:「接口即测试表面」失效,测试全绿不代表生产安全;
- file-store.ts 与 migrateMaterial 旧数据修补零测试。

## 改动范围

- `ProductStorage` 接口补契约注释:读返回快照拷贝;写完成后即持久可见;同一文件并发写串行。
- `FileStorage`:get/list 返回深拷贝;flush 串行队列化(每次写排队执行);临时文件 + 原子改名落盘(与 audio-intake 一致),失败不留半成品。
- 新增参数化契约测试(同一套用例跑两个适配器):保存后可读回、修改返回值不污染仓库、并发保存多实体后全部持久、缺省读返回 null。
- migrateMaterial 补回归测试:构造旧格式 db.json(素材缺 turns 但有 transcript),加载后 turns 按转写补齐。
- `InMemoryStorage` 语义不变。

## 前后对照验收

- 前:FileStorage 的 getMaterial 返回内部对象,调用方 push 后不 save 也会留在仓库里(仅生产路径存在)。
- 后:两个适配器过同一套契约测试;FileStorage 每次读都是拷贝,并发写串行原子落盘;全量测试无回归。

## Comments

- 2026-09-09 已实现:FileStorage 读(get/list)返回深拷贝、flush 改为入队快照 + 串行链 + 临时文件原子改名落盘(前次失败不阻塞后续);ProductStorage 接口补契约注释;新增 server/storage-contract.test.ts 13 条——同一套契约用例参数化跑 InMemoryStorage 与 FileStorage(快照隔离、并发保存、覆盖、缺省读),另补 FileStorage 磁盘行为(重建实例持久化、旧格式 migrate、损坏文件启动报错)。全量 97 测试通过。待人工验收。
