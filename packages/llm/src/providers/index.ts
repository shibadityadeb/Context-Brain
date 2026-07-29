/**
 * Configured (user-supplied) multi-provider layer. Separate from the Codex
 * backend Brain uses today — see {@link ./types} for the rationale.
 */

export * from './types.js';
export { PROVIDER_CATALOG, PROVIDER_CATALOG_LIST, getProviderCatalogEntry } from './catalog.js';
export { createConfiguredProvider, ProviderConfigError } from './factory.js';
export {
  ProviderHttpError,
  ProviderUnreachableError,
  toConnectionResult,
  parseJsonLoose,
} from './http.js';
export { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
export { AnthropicProvider } from './AnthropicProvider.js';
export { GeminiProvider } from './GeminiProvider.js';
