/**
 * 手机端环境标记(手机适配):粗指针(触屏)设备给 <html> 打 data-touch,
 * mobile.css 据此隐藏 Enter / Shift+Enter 这类键盘提示。
 * 用 JS 判定而不靠 CSS 媒体查询嵌套,旧版微信内置浏览器也能生效。
 */
export function initMobileEnv(root: HTMLElement = document.documentElement): () => void {
  const coarse = window.matchMedia?.("(hover: none) and (pointer: coarse)");
  const syncTouch = () => {
    if (coarse?.matches) root.dataset.touch = "true";
    else delete root.dataset.touch;
  };
  syncTouch();
  coarse?.addEventListener?.("change", syncTouch);

  return () => {
    coarse?.removeEventListener?.("change", syncTouch);
    delete root.dataset.touch;
  };
}
