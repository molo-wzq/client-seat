# 07: 三通素材转写入库与拆解

**Type:** task

**What to build:** 用户提供 3 通真实电话录音(`l1/audio/`);逐通完成转写、脱敏、质量检查、拆解(案例分析 + 策略卡),归档素材类型;拆解完成后盘点三类场景(顺利沟通/软拒绝/明确拒绝)覆盖情况,缺口向用户确认是否以合成素材补(ADR 0003 决定 2)。

**Blocked by:** 用户提供录音文件(外部输入,放至 `l1/audio/` 后告知代理即可开工).

**Status:** needs-info

实现口径见 ADR 0003:真实录音与未脱敏转写不进 git(`l1/audio/`、`transcripts/_unscreened/` 已 gitignore);转写用 `l1/tools/transcribe.mjs`,原始稿只落 `_unscreened/`,脱敏复核后方可移入 `transcripts/`;检查按 `material-quality-checklist.md`,拆解按 `case-analysis-template.md` 与 `strategy-card-template.md`;素材类型为入库必填归档项。

- [ ] 3 通录音全部完成转写与脱敏,正式稿入库 `transcripts/`(含检查记录)。
- [ ] 每通出具检查记录,结论为"进入拆解"或记录不进入原因。
- [ ] 每通完成案例分析 + 策略卡拆解,标注素材类型(顺利沟通/软拒绝/明确拒绝)。
- [ ] 场景覆盖盘点完成;如有缺口,已向用户确认补编方案并记录结论。
- [ ] 拆解产物通过用户确认(quality gate:拆解偏差由用户业务判断纠正)。
