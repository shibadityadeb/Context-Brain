/**
 * Provider for the Google Gemini (Generative Language) REST API. The key is
 * passed as a query parameter per Google's convention.
 */

import type { GenerateJsonOptions, GenerateOptions } from '../types.js';
import type { ConfiguredLLMProvider, ConfiguredProviderId, ConnectionResult } from './types.js';
import { parseJsonLoose, providerFetch, toConnectionResult } from './http.js';

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export class GeminiProvider implements ConfiguredLLMProvider {
  readonly name = 'gemini';
  readonly providerId: ConfiguredProviderId = 'gemini';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(input: { apiKey: string; baseUrl: string; model: string }) {
    this.apiKey = input.apiKey;
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.model = input.model;
  }

  private key(): string {
    return encodeURIComponent(this.apiKey);
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const data = await providerFetch<GenerateContentResponse>({
      method: 'POST',
      url: `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${this.key()}`,
      headers: { 'content-type': 'application/json' },
      body: { contents: [{ parts: [{ text: prompt }] }] },
      options,
    });
    return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
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
        url: `${this.baseUrl}/models?key=${this.key()}`,
        headers: { 'content-type': 'application/json' },
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
