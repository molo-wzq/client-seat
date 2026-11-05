import type {
  CopywritingPort,
  DialoguePort,
  ManagerTurnInput,
  ManagerTurnOutput,
  TranscriptAnalysis,
} from "../domain/ports";
import { errorMessage, maskModelSecrets } from "./model-errors";

/**
 * 通用流式补全端口(工单 13):与 server/agent 的 AgentModelPort 结构一致,
 * 此处只声明FailoverModelAdapter需要的最小形状,不反向依赖 server 层。
 */
export interface CompleteStreamPort {
  completeStream(
    messages: Array<{ role: string; content: string }>,
    onDelta?: (delta: string) => void,
  ): Promise<string>;
}

/** 链上适配器需实现的三组端口:素材分析、经理对话、通用流式补全。 */
export type ChainableModelAdapter = CopywritingPort & DialoguePort & CompleteStreamPort;

/**
 * 按角色的 fallback 链(工单 13):主模型失败(网关 5xx、连接失败、超时)时
 * 依次切到链上的下一个模型。流式调用有硬边界——只有"一个字都没流出"的
 * 失败才切换;半截话术后再切下一个,用户会看到两段模型拼接的怪话,
 * 不如让本轮报错由用户重试。
 */
export class FailoverModelAdapter implements CopywritingPort, DialoguePort, CompleteStreamPort {
  constructor(private readonly chain: readonly ChainableModelAdapter[]) {
    if (chain.length === 0) throw new Error("FailoverModelAdapter 的模型链为空,至少要有一个模型");
  }

  async analyzeTranscript(transcript: string): Promise<TranscriptAnalysis> {
    let lastError: unknown;
    for (const model of this.chain) {
      try {
        return await model.analyzeTranscript(transcript);
      } catch (error) {
        lastError = error;
        console.warn("[failover] 素材分析失败,切链上下一个模型:", maskModelSecrets(errorMessage(error)));
      }
    }
    throw lastError;
  }

  async generateManagerTurn(
    input: ManagerTurnInput,
    onReplyDelta?: (delta: string) => void,
  ): Promise<ManagerTurnOutput> {
    let lastError: unknown;
    for (const model of this.chain) {
      let streamed = false;
      try {
        return await model.generateManagerTurn(input, (delta) => {
          streamed = true;
          onReplyDelta?.(delta);
        });
      } catch (error) {
        if (streamed) throw error;
        lastError = error;
        console.warn("[failover] 对话失败(话术未流出),切链上下一个模型:", maskModelSecrets(errorMessage(error)));
      }
    }
    throw lastError;
  }

  async completeStream(
    messages: Array<{ role: string; content: string }>,
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    let lastError: unknown;
    for (const model of this.chain) {
      let streamed = false;
      try {
        return await model.completeStream(messages, (delta) => {
          streamed = true;
          onDelta?.(delta);
        });
      } catch (error) {
        if (streamed) throw error;
        lastError = error;
        console.warn("[failover] 流式补全失败(无增量流出),切链上下一个模型:", maskModelSecrets(errorMessage(error)));
      }
    }
    throw lastError;
  }
}
