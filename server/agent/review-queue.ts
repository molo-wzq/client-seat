import fs from "node:fs";
import path from "node:path";

/**
 * 策略卡人审队列(工单 16 审批闭环):玩家同意盲区草稿后,草稿进这个队列
 * 等人工提炼策略卡。队列只是草稿清单——Worker 手上没有任何发布接口,
 * 上不上牌库仍走素材库的人审流程(ADR 0007 闸门不变)。
 * 存储:data/agent/card-review-queue.json,只追加。
 */

/** 队列条目:盲区草稿原文 + 归档时间。 */
export interface BlindspotDraftEntry {
  draft: string;
  at: string;
}

function queueFile(baseDir: string): string {
  return path.join(baseDir, "data", "agent", "card-review-queue.json");
}

/** 读整个队列;文件缺失或损坏按空队列处理。 */
export function listBlindspotDrafts(baseDir: string): BlindspotDraftEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(queueFile(baseDir), "utf-8")) as unknown;
    return Array.isArray(parsed) ? (parsed as BlindspotDraftEntry[]) : [];
  } catch {
    return [];
  }
}

/** 追加一条盲区草稿(只追加,不改既有条目)。 */
export function appendBlindspotDraft(baseDir: string, draft: string): void {
  const entries = listBlindspotDrafts(baseDir);
  entries.push({ draft, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(queueFile(baseDir)), { recursive: true });
  fs.writeFileSync(queueFile(baseDir), JSON.stringify(entries, null, 2), "utf-8");
}
