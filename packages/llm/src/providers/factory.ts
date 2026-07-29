/**
 * Builds a {@link ConfiguredLLMProvider} from a provider id + runtime config.
 * This is the seam a future feature calls (via the app's `getCurrentLLMProvider`)
 * to obtain the user's configured backend. It does NOT touch the Codex path.
 */

import { AnthropicProvider } from './AnthropicProvider.js';
import { getProviderCatalogEntry } from './catalog.js';
import { GeminiProvider } from './GeminiProvider.js';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type {
  ConfiguredLLMProvider,
  ConfiguredProviderId,
  ProviderRuntimeConfig,
} from './types.js';

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/**
 * Resolve the effective base URL: fixed from the catalog, or the caller's
 * override for custom endpoints. Throws when a required base URL is missing.
 */
function resolveBaseUrl(id: ConfiguredProviderId, override?: string | null): string {
  const entry = getProviderCatalogEntry(id);
  if (entry.requiresBaseUrl) {
    const url = override?.trim();
    if (!url) throw new ProviderConfigError(`${entry.label} requires a base URL.`);
    return url;
  }
  return entry.baseUrl!;
}

export function createConfiguredProvider(
  id: ConfiguredProviderId,
  config: ProviderRuntimeConfig,
): ConfiguredLLMProvider {
  const entry = getProviderCatalogEntry(id);
  if (!config.apiKey?.trim()) throw new ProviderConfigError(`${entry.label} requires an API key.`);
  const model = config.model?.trim() || entry.defaultModel;
  if (!model) throw new ProviderConfigError(`${entry.label} requires a model.`);
  const baseUrl = resolveBaseUrl(id, config.baseUrl);
  const apiKey = config.apiKey;

  switch (entry.wire) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey, baseUrl, model });
    case 'gemini':
      return new GeminiProvider({ apiKey, baseUrl, model });
    case 'openai':
      return new OpenAICompatibleProvider({ providerId: id, apiKey, baseUrl, model });
  }
}
