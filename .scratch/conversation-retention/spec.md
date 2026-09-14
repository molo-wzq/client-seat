# Spec: 对话存储上限(最大存储时间 + 最大存储对话数)

Status: ready-for-agent

## 背景与动机

对话记录是唯一会随使用无限增长的实体(素材/画像是人工录入,量可控)。`data/db.json`
整文件落盘、每次写全量重写,长期使用后旧对话会拖慢每次保存,也让历史列表越来越长。

## 需求

1. **最大存储时间**:对话创建时间距今超过保留期的,自动清理。
2. **最大存储对话数**:存量对话超过条数上限时,从最旧的一端淘汰。

两条规则取并集;不区分 ongoing/ended(废弃的进行中通话同样是存储负担)。

## 设计决策

- 保留策略是**领域规则**,不是存储实现细节:纯函数放
  `src/domain/conversation-retention.ts`,输入对话快照 + 当前时间 + 策略,输出待清理 id。
- 执行时机:
  - 领域核心在**每次开新通话**(startConversation/quickStart 共用的落库点)后清理——
    所有新对话入口都过这里,不依赖 UI/HTTP 层;
  - 组合根(server/main.ts)**服务启动时**清理一次,保证不开新对话也能回收旧数据。
- 删除能力落在 `ProductStorage` 端口:`deleteConversations(ids)` 批量删,一次落盘。
  两个适配器(InMemoryStorage/FileStorage)同步实现,进存储契约测试。
- 配置走环境变量,组合根读取:
  - `CONVERSATION_MAX_AGE_DAYS`:默认 30;`0` 表示不限时间。
  - `CONVERSATION_MAX_COUNT`:默认 200;`0` 表示不限条数。
  - 非法值(负数/非整数)启动即报错退出,与 PORT 校验同风格。
- 时间注入:`createProductCore` 新增可选 `now` 依赖,测试可固定时钟;缺省真实时钟。
- 排序口径与 `listConversations` 一致(创建时间倒序,id 作次级键),比较器提取为
  共享导出,单一定义。

## 验收

- [x] 纯函数:时间过期、超量淘汰、并集、0/不限、排序稳定性各有用例
- [x] 存储契约:deleteConversations 删除后不可读、空列表不落盘、两适配器行为一致
- [x] 集成:配置 maxCount 后开新通话自动挤掉最旧对话;maxAge 过期对话在开新通话时清理
- [x] env 读取:默认值、0=不限、非法值报错
- [x] README/CONTEXT.md 记录配置项与术语
