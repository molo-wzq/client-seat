# 09 · Watchdog

Status: done
Blocked by: 02

用定时消息驱动外部检查：工单超时没有进展时，重启它或把它标为受阻，并把原因写进待办。Watchdog 不对玩家说话。

验收：故事 16；用模拟卡住的 Worker 测试。

Comments: 2026-11-05 createWatchdog 可注入时钟/阈值(默认 10 分钟,WATCHDOG_THRESHOLD_MS 可调):超时先 retryTicket 重跑 Worker,再超时 appendSystemReport 落 blocked 带原因、进待办,不发桌宠气泡;waiting/已收口工单不干预。用模拟卡死 Worker 钉住全链路。
