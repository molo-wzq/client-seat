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

// 全局按钮按压声(捕获阶段一次绑定,AudioContext 等首次手势再创建)。
initPointerSfx();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={createHttpProductCore()} />
  </StrictMode>,
);
