import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createHttpProductCore } from "./product/http-product-api";
import { initPointerSfx } from "./ui/game-feel";
import "./ui/ui.css";
import "./ui/tavern-rail.css";
import "./ui/game-design.css";
// 实体桌游皮肤:最后加载,只改观感(米白卡纸 + 墨绿桌垫),见 .scratch/tabletop-skin/spec.md。
import "./ui/tabletop-skin.css";
// 手机适配:只在 ≤820px / 触屏下生效,必须最后加载以覆盖上面各层的窄屏规则。
import "./ui/mobile.css";
import { initMobileEnv } from "./ui/mobile-env";

// 全局按钮按压声(捕获阶段一次绑定,AudioContext 等首次手势再创建)。
initPointerSfx();
// 手机端环境标记:触屏设备隐藏键盘快捷键提示。
initMobileEnv();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={createHttpProductCore()} />
  </StrictMode>,
);
