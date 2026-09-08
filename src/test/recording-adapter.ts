import { FakeModelAdapter } from "../adapters/fake-model-adapter";
import type { ManagerTurnInput, ManagerTurnOutput } from "../domain/ports";

/** 测试用伪适配器:记录每次对话生成的完整入参,供断言策略检索与画像边界。 */
export class RecordingAdapter extends FakeModelAdapter {
  dialogueInputs: ManagerTurnInput[] = [];

  async generateManagerTurn(input: ManagerTurnInput): Promise<ManagerTurnOutput> {
    this.dialogueInputs.push(structuredClone(input));
    return super.generateManagerTurn(input);
  }
}
