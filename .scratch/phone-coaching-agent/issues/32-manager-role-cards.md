# 32 · 经理角色卡:打法体系数据化与检索注入实验

Status: ready-for-human

## 背景

调研 SillyTavern 角色卡(CCv2)后确认:尾部提醒≈post_history_instructions、示范轮≈mes_example、常驻规律≈constant 世界书条目,机制本就同构;但人设与规则硬编码在 prompts.ts,换经理要动多处镜像。角色卡的价值不在社区流通,在行内多角色——不同优秀理财经理有不同打法体系(语体、钱规律、通话规则),应作为数据创建、更换、流通。

## 决定

- 角色卡承载**整套打法**:description(身份/称呼)、personality、callLogic(钱规律)+callLogicIntro、rules(全部通话规则,含语体契约)、first_mes(演示/降级用,真实开场仍按画像生成)、mes_example、post_history_instructions;宏 {{char}}/{{maxTurns}} 渲染期替换。字段命名对齐 CCv2,JSON 载体,不做 PNG、不做酒馆互通。
- 共享层收窄为运行时数据(本局画像、本局事实、策略卡组)+系统硬约束(12 轮上限、隐藏信息隔离、裁判纪律)。角色卡与策略卡组正交。
- 开局选择角色并快照进 conversation.resources.role;裁判 logicHint、布置幕桌边卡面、复盘标尺三处消费点改读快照,旧记录回退默认卡渲染不变。
- 镜像点清理:cleanReplyText/流式首部正则按本局经理名剥前缀;伪适配器开场用当前卡 first_mes;快捷语用当前卡姓名。
- 内置两卡:小王(默认,渲染输出与 p15 逐字等价,金样由 prompts.test 钉住)、老陈(稳重型,差异在语体契约/示范轮/尾部提醒,规律沿用)。
- JSON 导入导出(/api/roles):逐字段校验,未知字段收进 extensions 保留;每次导入分配新 id。
- 附带落地世界书式检索注入实验(LLM_CARD_RETRIEVAL=1,默认关):策略卡新增可选 triggerKeywords(字面词,区别于语义化 triggerSignals;缺省/空=常驻上桌),按最近 2 条客户发言子串匹配决定上桌子集;经理轮落库 injectedCardIds 供复盘核对;usedCardId 仍对全量已发布卡校验;开启时策略段头改「检索上桌」口径。分析提示词产关键词,草稿卡编辑器可改,种子卡 SC2/SC3 已回填(SC1 开场卡按蓝灯语义常驻)。

## 验收

- npm test + npm run typecheck 全绿;默认路径(不换卡、开关关)行为与 p15 逐字一致。
- 布置幕可选经理;换卡后开场自称、提示词、桌边规律随卡变化;复盘显示本局经理与该套规律。
- 角色卡可导出 JSON、导入即用;非法卡 400。

## Comments

- 2026-10-28 实施完成:role-card.ts/card-retrieval.ts/prompt-tuning.ts 新建;file-store 与 InMemoryStorage 增 roles;app-server 增 /api/roles 与 roleId 透传;PROMPT_VERSION 升 p16。待真实模型下各抽一局换卡与检索对照。
