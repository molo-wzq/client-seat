export const DEFAULT_ASR_MODEL = "mimo-v2.5-asr";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const SUPPORTED_AUDIO_FORMATS = ["mp3", "m4a", "wav", "webm", "ogg"] as const;

export type AudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

export interface AudioTranscriber {
  transcribe(input: { bytes: Buffer; format: AudioFormat }): Promise<string>;
}

export interface SpeakerDiarizer {
  diarize(transcript: string): Promise<string>;
}

const DIARIZE_PROMPT = `你只负责给中文银行电话转写稿区分说话人。
要求:
1. 严格保留原文顺序与信息,不要总结、润色或补写。
2. 按自然发言轮次换行,从 T01 开始连续编号。
3. 每行格式只能是“T01 经理:原话”或“T02 客户:原话”。
4. 根据称呼、业务动作和上下文判断经理/客户;判断不稳也必须选择其一,留给人工校对。
5. 只输出转写正文,不要解释,不要 Markdown 代码块。`;

export function parseAudioFormat(fileName: string): AudioFormat {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (SUPPORTED_AUDIO_FORMATS.includes(extension as AudioFormat)) return extension as AudioFormat;
  throw new Error(`录音格式不支持,请使用 ${SUPPORTED_AUDIO_FORMATS.join("/")}`);
}

export class MimoAudioTranscriber implements AudioTranscriber {
  constructor(
    private readonly config: { apiKey: string; baseUrl: string; model?: string },
  ) {}

  async transcribe(input: { bytes: Buffer; format: AudioFormat }): Promise<string> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model || DEFAULT_ASR_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: input.bytes.toString("base64"), format: input.format },
              },
            ],
          },
        ],
      }),
    });

    const raw = await response.text();
    if (!response.ok) throw new Error(`录音转写失败(HTTP ${response.status}):${raw.slice(0, 300)}`);

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("录音转写服务返回了无效响应");
    }
    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("录音转写服务未返回文字");
    return content.trim();
  }
}

export class MimoSpeakerDiarizer implements SpeakerDiarizer {
  constructor(
    private readonly config: { apiKey: string; baseUrl: string; model: string },
  ) {}

  async diarize(transcript: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: DIARIZE_PROMPT },
          { role: "user", content: transcript },
        ],
      }),
    });

    const raw = await response.text();
    if (!response.ok) throw new Error(`说话人区分失败(HTTP ${response.status}):${raw.slice(0, 300)}`);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("说话人区分服务返回了无效响应");
    }
    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("说话人区分服务未返回文字");
    const cleaned = content.trim().replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "").trim();
    if (!/^T\d+\s+(?:经理|客户)[:：]/m.test(cleaned)) {
      throw new Error("说话人区分结果格式不合法");
    }
    return cleaned;
  }
}
