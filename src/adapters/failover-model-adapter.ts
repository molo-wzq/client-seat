import type {
  CopywritingPort,
  DialoguePort,
  ManagerTurnInput,
  ManagerTurnOutput,
  TranscriptAnalysis,
} from "../domain/ports";

/**
 * 双供应商故障转移:主模型调用失败(网关 5xx、连接失败、超时)时改用备用重试。
 * 流式话术有硬边界——只有"一个字都没流出"的失败才切换;半截话术后再切备用,
 * 用户会看到两段模型拼接的怪话,不如让本轮报错由用户重试。
 */
export class FailoverModelAdapter implements CopywritingPort, DialoguePort {
  constructor(
    private readonly primary: CopywritingPort & DialoguePort,
    private readonly fallback: CopywritingPort & DialoguePort,
  ) {}

  async analyzeTranscript(transcript: string): Promise<TranscriptAnalysis> {
    try {
      return await this.primary.analyzeTranscript(transcript);
    } catch (error) {
      console.warn("[failover] 主模型素材分析失败,改用备用:", (error as Error).message);
      return await this.fallback.analyzeTranscript(transcript);
    }
  }

  async generateManagerTurn(
    input: ManagerTurnInput,
    onReplyDelta?: (delta: string) => void,
  ): Promise<ManagerTurnOutput> {
    let streamed = false;
    try {
      return await this.primary.generateManagerTurn(input, (delta) => {
        streamed = true;
        onReplyDelta?.(delta);
      });
    } catch (error) {
      if (streamed) throw error;
      console.warn("[failover] 主模型对话失败(话术未流出),改用备用:", (error as Error).message);
      return await this.fallback.generateManagerTurn(input, onReplyDelta);
    }
  }
}
