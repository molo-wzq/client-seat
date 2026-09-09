/** 加载提示:模型调用期间(分析/对话/结果生成可能 5–25 秒)给出可见反馈,避免界面像卡死。 */
export function BusyHint({ text }: { text: string }) {
  return (
    <p className="busy-hint" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {text}
    </p>
  );
}
