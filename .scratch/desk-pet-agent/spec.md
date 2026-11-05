# 桌宠 Agent（客户侧搭档 + 项目管家）

Status: ready-for-agent
依据：docs/adr/0007、design/03-tavern-keeper.md（v7–v9）、deepseek-ai/dsh-superagent-prototype docs/001-domain.md 与 002-authorization.md。

## Problem Statement

玩家坐在客户席，独自面对 AI 经理，牌桌上缺少一个陪他看局、帮他处理琐事的存在。隐藏信息有没有被经理挖出来，目前只能等到结算时自己对照。项目的素材、投研、复盘全靠人工在各页面之间来回切换。我们需要一个可以展示、看得见、能实际干活的 Agent。

## Solution

牌桌一角常驻一个 Q 版桌宠（男女两版可选），它是 Super-agent 的 Router，唯一负责对人说话。它背后有一组相互隔离的 Worker 执行具体工作。桌宠坐在客户一侧，替玩家翻开隐藏牌，陪玩家看经理出招；它也是项目管家，负责素材、投研和待办。**本期以前端展示为主**：demo 模式下所有能力都要完整可演示。

## User Stories

1. 作为玩家，我打开应用就能看到桌宠在牌桌角，有待机小动作；可以拖动它，也可以设为勿扰收起。
2. 作为玩家，我可以在男女两版之间切换。
3. 作为玩家，对局中桌宠不说话，只用表情回应经理的出招（点头、鼓腮、惊讶）。
4. 作为玩家，我说出的隐藏信息会由桌宠自动翻牌，并标注「第 N 轮，经理用某某策略卡问出」，显示 x/N。
5. 作为玩家，经理问到边上但我还没松口时，桌宠会举牌，由我点「翻」或「先藏着」。
6. 作为玩家，结算时桌宠会揭晓没翻开的牌，并说明经理漏了哪个信号。它不评价我。
7. 作为玩家，对局一结束，桌宠就用一句话（不超过 40 字）说出这局经理哪招值得学，点「展开」可看依据。
8. 作为玩家，点击桌宠会弹出快捷环：换个客户、再来一局、上局复盘、本周投研。
9. 作为玩家或管理员，按 Ctrl+K 唤出命令条，可以打字或按住说话；Worker 干活时我仍可以继续下指令。
10. 作为管理员，我能在桌宠旁看到多个工单并行推进（进展、等待、就绪、受阻、失败）。
11. 作为管理员，桌宠头顶角标显示待我决定的数量，点开是待办面板。
12. 作为管理员，把录音、画像 JSON、角色卡拖到桌宠身上，会自动交给 Worker 起草，并进入待审。
13. 作为管理员，在待审卡上写批注，原工单会被唤醒并按批注修改。
14. 作为管理员，可以把放权模式切换为 off、observe、auto，并查看每条评估记录（本来会做什么，为什么）。
15. 作为汇报人，可以一键运行演示脚本，完整展示以上能力，不依赖真实模型。
16. 作为维护者，Watchdog 发现 Worker 卡住会重启它或标为受阻，并在待办中说明原因。

## Implementation Decisions

- **领域对象**（对齐 dsh 领域模型）：Source、Trigger、Thread、Eval（准入 + 研判）、Policy（带版本、规则、放权模式）、Mandate（explicit/inferred）、Ticket、Assignment、Report（progress/waiting/ready/blocked/failed/dropped）、Channel。
- **账本**：只追加，记录 Trigger、Decision、Disposition、Report，存在 file-store 和 InMemoryStorage，沿用 storage-contract。
- **Source**：table（开局、每轮、结束）、materials（上传、草稿改动、发布）、research（周报到达、到期；到期由 Source 自己计时）、pet（命令条、拖拽、点击）、system（模型报错）。
- **Thread 键**：gameId、materialId、personaId、weekId、commandId。
- **Router**：轻量模型或 demo 脚本适配器，只做分派和说话，不写业务数据。
- **Worker**：揭示判定、复盘、素材、盲区、画像、投研；用强模型或 demo 适配器。揭示判定订阅本局 Thread，每轮事件直接送达。
- **隔离**：经理会话与 Agent 上下文物理隔离。揭示判定结果只写入客户侧账本。需加测试钉住：经理提示词中不得出现隐藏信息字段。
- **推送**：前端用 SSE 订阅 Report 和 Channel 事件。前端只读账本视图，不直接调用 Worker。
- **Channel**：桌宠气泡（硬上限 40 字）、翻牌动画、结算页插槽、素材库草稿、待办面板。
- **放权**：凡会让经理说出新内容的产出一律是草稿，走现有「人工决定什么可以上桌」流程。
- **可替换**：编排层只通过接口暴露 `emitTrigger / subscribe / ledger`，以后可换 DSH 或 DeerFlow。
- **美术**：沿用 docs/design/ui-asset-library-v1.md 的 token；角色参照 design/assets/desk-pet-concept.png（仅作氛围参考，正式立绘待人工绘制，先用占位图）。

## Testing Decisions

- 只测外部行为：给定 Trigger 序列，断言账本、Report 和 Channel 的输出；不测内部提示词措辞。
- 揭示判定：在 demo 适配器下，给定客户发言，断言翻牌、举牌、不动这三种结果，以及归因轮次。
- 隔离测试：任何路径下，经理提示词和上下文都不含隐藏信息。
- 前端：测试组件交互（快捷环、命令条、翻和藏、角标、拖拽入口），沿用现有 *.test.tsx 风格。
- 每张工单完成时：npm test、npm run typecheck、npm run build 全部通过；demo 模式手动走一遍对应故事。

## Out of Scope

- 选客推荐 Worker（用户 2026-11-04 明确不要）。
- 生物钟、养鱼数值（亲密度、心情、饱腹度）、成长阶段、随机打扰。
- 对外发消息（IM、邮件），关闭应用后的推送。
- L5 试用及 L6/L7。

## Further Notes

需要 /domain-modeling 补进 CONTEXT.md 的词：桌宠、隐藏牌（隐藏信息在牌桌上的呈现）、翻牌、举牌、工单、触发、线程、评估、授权、放权模式、待人决定。
