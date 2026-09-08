import { createProductCore } from "../domain/product-core";
import type { CopywritingPort, DialoguePort, ProductStorage } from "../domain/ports";
import type { Conversation, Material } from "../domain/types";
import type { ProductApi } from "./product-api";

/** 内存存储:测试与进程内组合根使用。 */
export class InMemoryStorage implements ProductStorage {
  private materials = new Map<string, Material>();
  private conversations = new Map<string, Conversation>();

  async saveMaterial(material: Material): Promise<void> {
    this.materials.set(material.id, structuredClone(material));
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
  }
  async getConversation(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation ? structuredClone(conversation) : null;
  }
}

export function createInProcessProductApi(input: {
  adapter: CopywritingPort & DialoguePort;
  storage?: ProductStorage;
}): ProductApi {
  const core = createProductCore({
    copywriting: input.adapter,
    dialogue: input.adapter,
    storage: input.storage ?? new InMemoryStorage(),
  });
  return core;
}
