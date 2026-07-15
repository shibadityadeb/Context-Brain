import { LLMProviderError, type LLMConfig, type LLMProvider } from './types.js';

const DEFAULT_MODEL = 'llama3.1';
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Local models via an Ollama-compatible /api/chat endpoint. */
export class LocalProvider implements LLMProvider {
  readonly name = 'local';
  readonly model: string;
  private readonly baseUrl: string;

  constructor(config: LLMConfig) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async complete(input: { system: string; prompt: string }): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LLMProviderError(
        `Local model ${response.status}: ${body.slice(0, 500)}`,
        this.name,
        response.status >= 500,
      );
    }
    const data = (await response.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }
}
