# 04 对局连续性与错误恢复

Status: ready-for-human
Implementation: complete

加载重试、输入法保护、零回合结束、结果失败保留结束状态。旧局迟到回复不能覆盖新局；断流后等待本轮落库并读取权威记录。新增回归先复现迟到回调与断流恢复缺陷，再验证修复。验收见 ../report.md。
