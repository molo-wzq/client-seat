import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProductStorage } from "../src/domain/ports";
import type { Conversation, Material, Persona } from "../src/domain/types";
import type { RoleCard } from "../src/domain/role-card";
import { DEFAULT_ROLE_CARD } from "../src/domain/role-card";
import { InMemoryStorage } from "../src/product/in-process-product-api";
import { FileStorage } from "./file-store";
import { InMemoryLedgerStorage, type LedgerStorage } from "./agent/storage";
import type { LedgerEntryInput } from "./agent/types";

function material(id: string, label = "素材"): Material {
  return {
    id,
    title: `${label}-${id}`,
    transcript: `T01 经理:您好(${id})`,
    turns: [{ number: 1, speaker: "manager", text: "您好" }],
    analysis: {} as Material["analysis"],
    cards: [],
    createdAt: "2026-09-09T00:00:00.000Z",
  };
}

function conversation(id: string): Conversation {
  return {
    id,
    personaId: "p01",
    status: "ongoing",
    turns: [],
    createdAt: "2026-09-09T00:00:00.000Z",
  };
}

function persona(id: string): Persona {
  return { id, name: `客户${id}`, visible: [], hidden: [] };
}

function role(id: string): RoleCard {
  return { ...structuredClone(DEFAULT_ROLE_CARD), id, name: `经理${id}` };
}

/** 每个用例一个独立临时 db 文件,避免用例间互相污染。 */
function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-contract-"));
  return path.join(dir, "db.json");
}

const factories: Array<[string, () => ProductStorage]> = [
  ["InMemoryStorage", () => new InMemoryStorage()],
  ["FileStorage", () => new FileStorage(tempDbFile())],
];

for (const [name, create] of factories) {
  describe(`存储契约:${name}`, () => {
    // 每个用例独立实例,避免用例间状态污染。
    const fresh = (): ProductStorage => create();

    it("保存后可读回,list 含该项", async () => {
      const storage = fresh();
      await storage.saveMaterial(material("m1"));
      await storage.saveConversation(conversation("c1"));
      await storage.savePersona(persona("p1"));
      await storage.saveRole(role("r1"));

      expect((await storage.getMaterial("m1"))?.title).toBe("素材-m1");
      expect((await storage.listMaterials()).map((m) => m.id)).toEqual(["m1"]);
      expect((await storage.listConversations()).map((c) => c.id)).toEqual(["c1"]);
      expect((await storage.listPersonas()).map((p) => p.id)).toEqual(["p1"]);
      expect((await storage.listRoles()).map((r) => r.id)).toEqual(["r1"]);
    });

    it("不存在返回 null,list 为空数组", async () => {
      const storage = fresh();
      expect(await storage.getMaterial("none")).toBeNull();
      expect(await storage.getConversation("none")).toBeNull();
      expect(await storage.listMaterials()).toEqual([]);
      expect(await storage.listRoles()).toEqual([]);
    });

    it("角色卡读返回快照:改动返回值不污染仓库", async () => {
      const storage = fresh();
      await storage.saveRole(role("r1"));
      const snapshot = (await storage.listRoles())[0];
      snapshot.rules.push("多出来的一条");
      const again = (await storage.listRoles())[0];
      expect(again.rules).toHaveLength(DEFAULT_ROLE_CARD.rules.length);
    });

    it("读返回快照:改动返回值不污染仓库", async () => {
      const storage = fresh();
      await storage.saveMaterial(material("m1"));
      const snapshot = await storage.getMaterial("m1");
      snapshot?.turns.push({ number: 2, speaker: "customer", text: "喂" });
      const again = await storage.getMaterial("m1");
      expect(again?.turns).toHaveLength(1);
    });

    it("并发保存不同实体,全部持久可见", async () => {
      const storage = fresh();
      await Promise.all([
        storage.saveMaterial(material("m1")),
        storage.saveMaterial(material("m2")),
        storage.saveConversation(conversation("c1")),
      ]);
      expect((await storage.listMaterials()).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
      expect(await storage.getConversation("c1")).not.toBeNull();
    });

    it("后保存覆盖先保存的同 id 数据", async () => {
      const storage = fresh();
      await storage.saveMaterial(material("m1", "旧"));
      await storage.saveMaterial(material("m1", "新"));
      expect((await storage.getMaterial("m1"))?.title).toBe("新-m1");
    });

    it("deleteConversations 批量删除;不存在的 id 与空列表不报错", async () => {
      const storage = fresh();
      await storage.saveConversation(conversation("c1"));
      await storage.saveConversation(conversation("c2"));

      await storage.deleteConversations(["c1", "none"]);

      expect(await storage.getConversation("c1")).toBeNull();
      expect((await storage.listConversations()).map((c) => c.id)).toEqual(["c2"]);
      // 空列表为无操作,不影响其余数据。
      await storage.deleteConversations([]);
      expect((await storage.listConversations()).map((c) => c.id)).toEqual(["c2"]);
    });
  });
}

function triggerRecord(id: string): LedgerEntryInput {
  return { type: "trigger", trigger: { id, source: "pet", kind: "command", data: { text: "去办" } } };
}

function reportRecord(ticketId: string): LedgerEntryInput {
  return { type: "report", report: { ticketId, status: "ready", text: "收到，马上办" } };
}

const ledgerFactories: Array<[string, () => LedgerStorage]> = [
  ["InMemoryLedgerStorage", () => new InMemoryLedgerStorage()],
  ["FileStorage", () => new FileStorage(tempDbFile())],
];

for (const [name, create] of ledgerFactories) {
  describe(`账本存储契约:${name}`, () => {
    // 每个用例独立实例,避免用例间状态污染。
    const fresh = (): LedgerStorage => create();

    it("append 按调用顺序分配递增 seq,list 按序返回", async () => {
      const storage = fresh();
      const first = await storage.appendLedgerEntry(triggerRecord("t1"));
      const second = await storage.appendLedgerEntry(reportRecord("k1"));
      expect(first.seq).toBe(1);
      expect(second.seq).toBe(2);
      expect(first.at).toBeTruthy();

      const entries = await storage.listLedgerEntries();
      expect(entries.map((entry) => entry.type)).toEqual(["trigger", "report"]);
      expect(entries.map((entry) => entry.seq)).toEqual([1, 2]);
    });

    it("list 返回快照:改动返回值不污染仓库", async () => {
      const storage = fresh();
      const stored = await storage.appendLedgerEntry(triggerRecord("t1"));
      const snapshot = await storage.listLedgerEntries();
      snapshot[0]!.seq = 999;
      const again = await storage.listLedgerEntries();
      expect(again[0]).toEqual(stored);
    });

    it("并发追加全部持久可见,seq 不重复不丢序", async () => {
      const storage = fresh();
      await Promise.all([
        storage.appendLedgerEntry(triggerRecord("t1")),
        storage.appendLedgerEntry(triggerRecord("t2")),
        storage.appendLedgerEntry(reportRecord("k1")),
      ]);
      const entries = await storage.listLedgerEntries();
      expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
      expect(new Set(entries.map((entry) => entry.seq)).size).toBe(3);
    });
  });
}

describe("FileStorage 磁盘行为", () => {
  it("写后重建实例仍可读回(持久化)", async () => {
    const file = tempDbFile();
    const first = new FileStorage(file);
    await first.saveMaterial(material("m1"));
    const second = new FileStorage(file);
    expect((await second.getMaterial("m1"))?.title).toBe("素材-m1");
  });

  it("删除对话后重建实例仍是删除态(保留策略的清理持久生效)", async () => {
    const file = tempDbFile();
    const first = new FileStorage(file);
    await first.saveConversation(conversation("c1"));
    await first.saveConversation(conversation("c2"));
    await first.deleteConversations(["c1"]);

    const second = new FileStorage(file);
    expect((await second.listConversations()).map((c) => c.id)).toEqual(["c2"]);
  });

  it("账本写后重建实例仍可读回,seq 接续不重复(只追加持久)", async () => {
    const file = tempDbFile();
    const first = new FileStorage(file);
    await first.saveMaterial(material("m1"));
    await first.appendLedgerEntry(triggerRecord("t1"));

    const second = new FileStorage(file);
    const entries = await second.listLedgerEntries();
    expect(entries.map((entry) => entry.type)).toEqual(["trigger"]);
    // 账本与产品数据同文件共存,互不覆盖。
    expect((await second.listMaterials()).map((m) => m.id)).toEqual(["m1"]);

    const next = await second.appendLedgerEntry(reportRecord("k1"));
    expect(next.seq).toBe(2);
  });

  it("旧格式素材(缺 turns)加载时按转写补齐轮次", async () => {
    const file = tempDbFile();
    fs.writeFileSync(
      file,
      JSON.stringify({
        materials: [{ id: "old", title: "旧素材", transcript: "T01 经理:您好\nT02 客户:喂" }],
      }),
    );
    const storage = new FileStorage(file);
    const migrated = await storage.getMaterial("old");
    expect(migrated?.turns).toEqual([
      { number: 1, speaker: "manager", text: "您好" },
      { number: 2, speaker: "customer", text: "喂" },
    ]);
  });

  it("损坏的 JSON 文件启动即报错,不静默吞掉", async () => {
    const file = tempDbFile();
    fs.writeFileSync(file, "{ 不是合法 JSON");
    expect(() => new FileStorage(file)).toThrow();
  });
});
