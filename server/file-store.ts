import fs from "node:fs";
import path from "node:path";
import { numberTurns, parseTranscriptTurns } from "../src/domain/transcript";
import type { ProductStorage } from "../src/domain/ports";
import type { Conversation, Material, Persona } from "../src/domain/types";

/**
 * 本地 JSON 文件存储(spec.md:不引入数据库)。
 * 契约(与 InMemoryStorage 一致,见 server/storage-contract.test.ts):
 * - 读返回快照拷贝,调用方改动返回值不会污染仓库;
 * - 写 resolve 时即持久可见;并发写按调用顺序串行落盘;
 * - 临时文件 + 原子改名,失败不留半成品。
 */
export class FileStorage implements ProductStorage {
  private materials = new Map<string, Material>();
  private conversations = new Map<string, Conversation>();
  private personas = new Map<string, Persona>();
  private flushChain: Promise<void> = Promise.resolve();
  private serial = 0;

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        materials?: Material[];
        conversations?: Conversation[];
        personas?: Persona[];
      };
      for (const material of data.materials ?? []) {
        this.materials.set(material.id, migrateMaterial(material));
      }
      for (const conversation of data.conversations ?? [])
        this.conversations.set(conversation.id, conversation);
      for (const persona of data.personas ?? []) this.personas.set(persona.id, persona);
    }
  }

  async saveMaterial(material: Material): Promise<void> {
    this.materials.set(material.id, structuredClone(material));
    await this.flush();
  }
  async listMaterials(): Promise<Material[]> {
    return [...this.materials.values()].map((m) => structuredClone(m));
  }
  async getMaterial(id: string): Promise<Material | null> {
    const material = this.materials.get(id);
    return material ? structuredClone(material) : null;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, structuredClone(conversation));
    await this.flush();
  }
  async getConversation(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation ? structuredClone(conversation) : null;
  }
  async listConversations(): Promise<Conversation[]> {
    return [...this.conversations.values()].map((c) => structuredClone(c));
  }

  async savePersona(persona: Persona): Promise<void> {
    this.personas.set(persona.id, structuredClone(persona));
    await this.flush();
  }
  async listPersonas(): Promise<Persona[]> {
    return [...this.personas.values()].map((p) => structuredClone(p));
  }

  /** 快照在入队时取,写按入队顺序串行执行;前一次失败不阻塞后续写。 */
  private flush(): Promise<void> {
    const data = {
      materials: [...this.materials.values()],
      conversations: [...this.conversations.values()],
      personas: [...this.personas.values()],
    };
    const content = JSON.stringify(data, null, 2);
    const serial = ++this.serial;
    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.filePath, content, serial));
    return this.flushChain;
  }
}

/** 临时文件 + 原子改名;写失败清理临时文件后抛出。 */
async function writeFileAtomic(filePath: string, content: string, serial: number): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${serial}`;
  try {
    await fs.promises.writeFile(temporaryPath, content, "utf8");
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** 兼容旧数据文件:缺轮次的素材按转写解析兜底(可再由用户纠正)。 */
function migrateMaterial(material: Material): Material {
  if (Array.isArray(material.turns)) return material;
  return {
    ...material,
    turns: numberTurns(parseTranscriptTurns(material.transcript)),
  };
}
