import { LLMProviderError, type LLMConfig, type LLMProvider } from './types.js';

const DEFAULT_MODEL = 'gpt-4o';
const API_URL = 'https://api.openai.com/v1/chat/completions';

/** OpenAI chat completions with JSON-mode output. */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly maxOutputTokens: number;

  constructor(config: LLMConfig) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxOutputTokens = config.maxOutputTokens ?? 16000;
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  }

  async complete(input: { system: string; prompt: string }): Promise<string> {
    if (!this.apiKey) {
      // Checked at call time so the worker can boot before the key is set.
      throw new LLMProviderError('OPENAI_API_KEY is not configured', this.name, false);
    }
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: this.maxOutputTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LLMProviderError(
        `OpenAI ${response.status}: ${body.slice(0, 500)}`,
        this.name,
        response.status === 429 || response.status >= 500,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
