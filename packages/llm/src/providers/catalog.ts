/**
 * Static catalog of configurable providers. Consumed by the Settings API
 * (`GET /api/v1/llm/providers`) to render the form, and by the factory to
 * resolve fixed base URLs and wire formats.
 *
 * Well-known providers (OpenAI, Anthropic, Gemini) expose a fixed model
 * dropdown. Aggregators/custom endpoints (Groq, OpenRouter, Together, Custom)
 * have large or user-specific model lists, so they take a free-text model id
 * copied from the provider's docs (`modelsDocUrl`).
 */

import type { ConfiguredProviderId, ProviderCatalogEntry } from './types.js';

export const PROVIDER_CATALOG: Record<ConfiguredProviderId, ProviderCatalogEntry> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultModel: 'gpt-4o-mini',
    modelSelection: 'list',
    models: ['gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'gpt-4.1', 'gpt-4.1-mini'],
    apiKeyLabel: 'API Key',
    docsUrl: 'https://platform.openai.com/api-keys',
    modelsDocUrl: 'https://platform.openai.com/docs/models',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultModel: 'claude-sonnet-5',
    modelSelection: 'list',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    apiKeyLabel: 'API Key',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    modelsDocUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    wire: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultModel: 'gemini-2.0-flash',
    modelSelection: 'list',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    apiKeyLabel: 'API Key',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    modelsDocUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    wire: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultModel: 'llama-3.3-70b-versatile',
    modelSelection: 'freeform',
    models: [],
    apiKeyLabel: 'API Key',
    docsUrl: 'https://console.groq.com/keys',
    modelsDocUrl: 'https://console.groq.com/docs/models',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    wire: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultModel: 'openai/gpt-4o-mini',
    modelSelection: 'freeform',
    models: [],
    apiKeyLabel: 'API Key',
    docsUrl: 'https://openrouter.ai/keys',
    modelsDocUrl: 'https://openrouter.ai/models',
  },
  together: {
    id: 'together',
    label: 'Together AI',
    wire: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    supportsBaseUrl: false,
    requiresBaseUrl: false,
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    modelSelection: 'freeform',
    models: [],
    apiKeyLabel: 'API Key',
    docsUrl: 'https://api.together.ai/settings/api-keys',
    modelsDocUrl: 'https://docs.together.ai/docs/serverless-models',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    wire: 'openai',
    baseUrl: null,
    supportsBaseUrl: true,
    requiresBaseUrl: true,
    defaultModel: '',
    modelSelection: 'freeform',
    models: [],
    apiKeyLabel: 'API Key',
    docsUrl: '',
    modelsDocUrl: '',
  },
};

export const PROVIDER_CATALOG_LIST: ProviderCatalogEntry[] = Object.values(PROVIDER_CATALOG);

export function getProviderCatalogEntry(id: ConfiguredProviderId): ProviderCatalogEntry {
  return PROVIDER_CATALOG[id];
}
