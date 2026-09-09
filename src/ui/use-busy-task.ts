import { useState } from "react";

/**
 * 异步操作的忙态与错误提示:模型调用可能 5–25 秒,统一提供
 * busy(禁用交互)+ busyHint(BusyHint 文案)+ error 三件套。
 */
export function useBusyTask(defaultHint: string) {
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState(defaultHint);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>, hint = defaultHint) {
    setBusy(true);
    setBusyHint(hint);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return { busy, busyHint, error, setError, run };
}
