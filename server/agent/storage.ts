import type { LedgerEntry, LedgerEntryInput } from "./types";

/**
 * Agent 账本存储接缝(spec:账本只追加,存在 file-store 与内存两实现)。
 * 契约(与产品存储同风格,由 server/storage-contract.test.ts 参数化钉住):
 * - append 按调用顺序分配递增 seq,resolve 后即持久可见;
 * - list 返回按 seq 升序的快照拷贝,改动返回值不污染仓库;
 * - 只追加:没有改写路径,seq 只进不退。
 */
export interface LedgerStorage {
  appendLedgerEntry(entry: LedgerEntryInput): Promise<LedgerEntry>;
  listLedgerEntries(): Promise<LedgerEntry[]>;
}

/** 内存账本:测试与进程内组合根使用。 */
export class InMemoryLedgerStorage implements LedgerStorage {
  private entries: LedgerEntry[] = [];

  async appendLedgerEntry(entry: LedgerEntryInput): Promise<LedgerEntry> {
    const stored: LedgerEntry = {
      ...entry,
      seq: this.entries.length + 1,
      at: new Date().toISOString(),
    } as LedgerEntry;
    this.entries.push(structuredClone(stored));
    return structuredClone(stored);
  }

  async listLedgerEntries(): Promise<LedgerEntry[]> {
    return [...this.entries].map((entry) => structuredClone(entry));
  }
}
