export const DEFAULT_ASR_MODEL = "mimo-v2.5-asr";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const SUPPORTED_AUDIO_FORMATS = ["mp3", "m4a", "wav", "webm", "ogg"] as const;

export type AudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

export interface AudioTranscriber {
  transcribe(input: { bytes: Buffer; format: AudioFormat }): Promise<string>;
}

const DIARIZE_PROMPT =
  "将这段中文电话录音转写为文字。录音中有两位说话人:银行理财经理和客户。" +
  '请逐句区分说话人,每行以"T01 经理:"或"T02 客户:"格式按实际顺序编号。' +
  "只输出录音中存在的内容,不要总结;不确定的内容标为[听不清]。";

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
              { type: "text", text: DIARIZE_PROMPT },
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
