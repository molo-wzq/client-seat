import fs from "node:fs";
import path from "node:path";
import { numberTurns, parseTranscriptTurns } from "../src/domain/transcript";
import type { ProductStorage } from "../src/domain/ports";
import type { Conversation, Material } from "../src/domain/types";

/** 本地 JSON 文件存储(spec.md:不引入数据库)。 */
export class FileStorage implements ProductStorage {
  private materials = new Map<string, Material>();
  private conversations = new Map<string, Conversation>();

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        materials?: Material[];
        conversations?: Conversation[];
      };
      for (const material of data.materials ?? []) {
        this.materials.set(material.id, migrateMaterial(material));
      }
      for (const conversation of data.conversations ?? [])
        this.conversations.set(conversation.id, conversation);
    }
  }

  async saveMaterial(material: Material): Promise<void> {
    this.materials.set(material.id, material);
    await this.flush();
  }
  async listMaterials(): Promise<Material[]> {
    return [...this.materials.values()];
  }
  async getMaterial(id: string): Promise<Material | null> {
    return this.materials.get(id) ?? null;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
    await this.flush();
  }
  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  private async flush(): Promise<void> {
    const data = {
      materials: [...this.materials.values()],
      conversations: [...this.conversations.values()],
    };
    await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
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
