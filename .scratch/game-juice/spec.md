# game-juice · 交互特效与打击感强化

Status: ready-for-human

## 背景与目标

用户反馈:整体优化项目,添加交互特效与部分打击感,让对练体验更丝滑。
项目已有一层动效基础(ui.css 的 motion layer),本次在其上补齐"游戏手感"的缺环:
**核心对局时刻(AI 出牌)没有重量感,且整局没有声音反馈。**

## 交付内容

### 1. 打击感引擎 `src/ui/game-feel.ts`(零素材)

- WebAudio 现场合成 6 种音效:`click`(按钮按压木叩)/ `send`(客户话术 pop)/
  `card`(策略卡拍桌闷响+纸面脆响)/ `dial`(回铃双音)/ `stamp`(结算盖章钝击)/
  `end`(挂机下行双音)。
- AudioContext 在首次用户手势时才创建(满足自动播放策略);无 AudioContext 环境
  (jsdom)全部安全退化为无操作。
- 静音开关持久化在 localStorage(`duilian-sfx`),默认开启。
- `thump()`:WAAPI 桌面震颤(1–2px、200ms),prefers-reduced-motion 时跳过。
- `initPointerSfx()`:main.tsx 一次绑定,捕获阶段监听全局按钮 pointerdown,
  全应用统一按压触感,无需逐组件接线。

### 2. 出牌拍桌演出(对局核心打击感)

TableAct 检测 `usedCardId` 变化(跳过挂载时的初始亮牌):
卡砖 `card-slam`(空中砸落 1.5x → 挤压回弹) + `tile-ripple`(outline 外扩涟漪)
+ 接管 `card-glow` 呼吸;同时 WAAPI 震颤整张牌桌 + `card` 音效。
同一张卡连出两轮也会重播(remount key 带 seq)。
砸落定格帧与在用卡的静态倾斜一致,收演不跳变。

### 3. 丝滑度

- `enterTable` 先切对局幕再后台刷目录:接通即刻上场,几百毫秒的目录等待消失
  (互斥位 enteringRef 原本就在,安全性不变)。
- 通话面板入场振铃两声(`connect-ring`),呼应点击时的拨号音。
- 通话气泡入场带 scale 微弹;通话轨道第 12 格走满红闪(`cell-final`)宣告强制收口。
- 按钮按下除下沉外轻微收缩回弹;明牌卡砖悬浮微抬;文字选中暖黄荧光笔。

### 4. 音效开关 UI

左栏底部新增(沉底,margin-top:auto),`aria-pressed` 反映状态,图标随开关联动。
关掉的那一下自身不响。

## 接线点

| 时刻 | 反馈 |
| --- | --- |
| 任意按钮按下 | click 木叩(全局监听) |
| 快速开始 / 接通电话 | dial 回铃音 |
| 客户话术发送(含 Enter 路径) | send pop |
| AI 出牌 | card 拍桌 + 卡砖砸落 + 桌面震颤 |
| 结束并查看结果 | end 挂机音 |
| 结算页挂载 ~450ms | stamp 盖章音(对齐 stamp-slam 砸落帧) |

## 测试

- `src/ui/game-feel.test.ts`:开关持久化、无 AudioContext 环境安全退化。
- `src/ui/LeftRail.test.tsx`:开关按钮状态切换与记忆。
- `src/ui/TableAct.test.tsx`:初始亮牌不触发 slam、换卡出牌触发 slam、当前目的展示。
- 全量 vitest 162 通过;`tsc -b` 与生产构建通过。
- 真机浏览器冒烟(1440×900,真实模型):布置→入座→接通→两轮对话(第 2 轮出牌
  `card-slam/tile-ripple/card-glow` 全挂)→结算(stamp-slam 正常)。

## 无障碍与降级

- 所有新动画被既有的 `prefers-reduced-motion` 全局守卫降级;WAAPI 震颤手动跳过。
- 音效独立于动效降级(听觉通道),可随时用左栏开关关闭并记忆。
