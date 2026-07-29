/**
 * Provider for any OpenAI Chat Completions-compatible endpoint: OpenAI, Groq,
 * OpenRouter, Together AI, and user-supplied custom endpoints.
 */

import type { GenerateJsonOptions, GenerateOptions } from '../types.js';
import type { ConfiguredLLMProvider, ConfiguredProviderId, ConnectionResult } from './types.js';
import { parseJsonLoose, providerFetch, ProviderHttpError, toConnectionResult } from './http.js';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAICompatibleProvider implements ConfiguredLLMProvider {
  readonly name: string;
  readonly model: string;
  readonly providerId: ConfiguredProviderId;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(input: {
    providerId: ConfiguredProviderId;
    apiKey: string;
    baseUrl: string;
    model: string;
  }) {
    this.providerId = input.providerId;
    this.name = input.providerId;
    this.apiKey = input.apiKey;
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.model = input.model;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const data = await providerFetch<ChatResponse>({
      method: 'POST',
      url: `${this.baseUrl}/chat/completions`,
      headers: this.headers(),
      body: {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      },
      options,
    });
    return data.choices?.[0]?.message?.content ?? '';
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
      // Listing models is the cheapest authenticated call most endpoints support.
      await providerFetch({
        method: 'GET',
        url: `${this.baseUrl}/models`,
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
      // Some custom endpoints don't implement /models — fall back to a 1-token chat.
      if (err instanceof ProviderHttpError && err.status === 404) {
        return this.testViaChat(signal);
      }
      return toConnectionResult(err);
    }
  }

  private async testViaChat(signal?: AbortSignal): Promise<ConnectionResult> {
    try {
      await providerFetch({
        method: 'POST',
        url: `${this.baseUrl}/chat/completions`,
        headers: this.headers(),
        body: { model: this.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
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
