import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProductStorage } from "../src/domain/ports";
import type { Conversation, Material, Persona } from "../src/domain/types";
import { InMemoryStorage } from "../src/product/in-process-product-api";
import { FileStorage } from "./file-store";

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

      expect((await storage.getMaterial("m1"))?.title).toBe("素材-m1");
      expect((await storage.listMaterials()).map((m) => m.id)).toEqual(["m1"]);
      expect((await storage.listConversations()).map((c) => c.id)).toEqual(["c1"]);
      expect((await storage.listPersonas()).map((p) => p.id)).toEqual(["p1"]);
    });

    it("不存在返回 null,list 为空数组", async () => {
      const storage = fresh();
      expect(await storage.getMaterial("none")).toBeNull();
      expect(await storage.getConversation("none")).toBeNull();
      expect(await storage.listMaterials()).toEqual([]);
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
