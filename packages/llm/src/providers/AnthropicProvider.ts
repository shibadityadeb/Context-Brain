/**
 * Provider for the Anthropic Messages API (`/v1/messages`).
 */

import type { GenerateJsonOptions, GenerateOptions } from '../types.js';
import type { ConfiguredLLMProvider, ConfiguredProviderId, ConnectionResult } from './types.js';
import { parseJsonLoose, providerFetch, toConnectionResult } from './http.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
}

export class AnthropicProvider implements ConfiguredLLMProvider {
  readonly name = 'anthropic';
  readonly providerId: ConfiguredProviderId = 'anthropic';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(input: { apiKey: string; baseUrl: string; model: string }) {
    this.apiKey = input.apiKey;
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.model = input.model;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const data = await providerFetch<MessagesResponse>({
      method: 'POST',
      url: `${this.baseUrl}/v1/messages`,
      headers: this.headers(),
      body: {
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      },
      options,
    });
    return (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  }

  async generateJson<T = unknown>(prompt: string, options?: GenerateJsonOptions<T>): Promise<T> {
    const text = await this.generate(
      `${prompt}\n\nReturn ONLY valid JSON with no prose or markdown.`,
      options,
    );
    const parsed = parseJsonLoose<T>(text);
    return options?.validate ? options.validate(parsed) : parsed;
  }

  async testConnection(signal?: AbortSignal): Promise<ConnectionResult> {
    try {
      await providerFetch({
        method: 'GET',
        url: `${this.baseUrl}/v1/models`,
        headers: this.headers(),
        options: { timeoutMs: 15_000, signal },
      });
      return {
        ok: true,
        status: 'connected',
        message: 'Connected successfully.',
        model: this.model,
      };
    } catch (err) {
      return toConnectionResult(err);
    }
  }
}
