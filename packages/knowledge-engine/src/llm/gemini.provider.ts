import { LLMProviderError, type LLMConfig, type LLMProvider } from './types.js';

const DEFAULT_MODEL = 'gemini-flash-latest';

/** Google Gemini via the Generative Language REST API. */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly apiKey: string;
  private readonly maxOutputTokens: number;

  constructor(config: LLMConfig) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxOutputTokens = config.maxOutputTokens ?? 16000;
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? '';
  }

  async complete(input: { system: string; prompt: string }): Promise<string> {
    if (!this.apiKey) {
      // Checked at call time so the worker can boot before the key is set.
      throw new LLMProviderError('GEMINI_API_KEY is not configured', this.name, false);
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      // Header auth works for both legacy AIza and new AQ.-prefixed keys,
      // and keeps the key out of URLs/logs.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: this.maxOutputTokens,
        },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LLMProviderError(
        `Gemini ${response.status}: ${body.slice(0, 500)}`,
        this.name,
        response.status === 429 || response.status >= 500,
      );
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  }
}
