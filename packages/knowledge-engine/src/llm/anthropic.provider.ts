import Anthropic from '@anthropic-ai/sdk';
import { LLMProviderError, type LLMConfig, type LLMProvider } from './types.js';

const DEFAULT_MODEL = 'claude-opus-4-8';

/** Claude via the official Anthropic SDK. */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxOutputTokens: number;

  constructor(config: LLMConfig) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxOutputTokens = config.maxOutputTokens ?? 16000;
    // With no explicit key the SDK resolves credentials from the
    // environment (ANTHROPIC_API_KEY / auth profile).
    this.client = new Anthropic(config.apiKey ? { apiKey: config.apiKey } : {});
  }

  async complete(input: { system: string; prompt: string }): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        thinking: { type: 'adaptive' },
        system: input.system,
        messages: [{ role: 'user', content: input.prompt }],
      });
      if (response.stop_reason === 'refusal') {
        throw new LLMProviderError('model refused the request', this.name, false);
      }
      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
    } catch (error) {
      if (error instanceof LLMProviderError) throw error;
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError
      ) {
        throw new LLMProviderError(error.message, this.name, true);
      }
      if (error instanceof Anthropic.APIError) {
        throw new LLMProviderError(error.message, this.name, false);
      }
      throw new LLMProviderError((error as Error).message, this.name, true);
    }
  }
}
