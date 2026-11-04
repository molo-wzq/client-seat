# 01 · 桌宠外壳（纯前端）

Status: done
Blocked by: 无

牌桌角常驻桌宠组件：男女两版可切换，5 个表情（挥手笑、拿笔想、欢呼、打瞌睡、鼓腮），待机小动作，可拖动，有勿扰模式；尊重减少动画偏好。正式立绘未到时先用占位图。

验收：故事 1、2；组件测试覆盖切换、拖动、勿扰；typecheck/build 通过。

## Comments

- 2026-11-04：新增 `src/ui/DeskPet.tsx` + `desk-pet.css`，App 牌桌右下角挂载；默认女版可切男版（localStorage 记住），expression 属性驱动 5 表情，勿扰收小圆钮，指针拖动后位置落盘，prefers-reduced-motion 关闭呼吸待机；6 个组件测试（红→绿逐片），typecheck/test/build 全绿。

