/**
 * Configured (user-supplied) LLM providers.
 *
 * These are the multi-provider backends a user can wire up from Settings —
 * distinct from the Codex CLI backend that Brain uses today. They implement
 * the same {@link ../provider.LLMProvider} contract so a future feature can
 * swap Codex for a user's provider with no caller changes, and they add
 * {@link ConfiguredLLMProvider.testConnection} for the Settings "Test" button.
 *
 * This subtree is intentionally pure: no persistence, no secrets handling.
 * The application layer decrypts the stored key and hands a plain
 * {@link ProviderRuntimeConfig} to {@link ./factory.createConfiguredProvider}.
 */

import type { LLMProvider } from '../provider.js';

/** Providers a user can configure from the Settings page. */
export type ConfiguredProviderId =
  'openai' | 'anthropic' | 'gemini' | 'groq' | 'openrouter' | 'together' | 'custom';

export const CONFIGURED_PROVIDER_IDS: readonly ConfiguredProviderId[] = [
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'openrouter',
  'together',
  'custom',
] as const;

/** Runtime config for a single provider (secrets already decrypted). */
export interface ProviderRuntimeConfig {
  /** The provider's API key / token. */
  apiKey: string;
  /** Override base URL. Required for `custom`; ignored where fixed. */
  baseUrl?: string | null;
  /** Model identifier, e.g. `gpt-4o-mini` or `claude-sonnet-5`. */
  model: string;
}

export type ConnectionStatus = 'connected' | 'invalid_key' | 'unreachable';

/** Result of a lightweight credential check. */
export interface ConnectionResult {
  ok: boolean;
  status: ConnectionStatus;
  /** Human-readable detail, safe to surface in the UI (never contains the key). */
  message: string;
  /** The model the provider reported/echoed, when available. */
  model?: string;
}

/** An {@link LLMProvider} that can also self-check its credentials. */
export interface ConfiguredLLMProvider extends LLMProvider {
  readonly providerId: ConfiguredProviderId;
  testConnection(signal?: AbortSignal): Promise<ConnectionResult>;
}

/** Wire protocol a provider speaks. */
export type ProviderWire = 'openai' | 'anthropic' | 'gemini';

/**
 * UI/runtime metadata for a provider. Drives the Settings form (which fields
 * to show, suggested models) and the factory (fixed base URLs, wire format).
 */
export interface ProviderCatalogEntry {
  id: ConfiguredProviderId;
  label: string;
  wire: ProviderWire;
  /** Fixed endpoint, or `null` when the user must supply one (custom). */
  baseUrl: string | null;
  /** Whether the Base URL field is shown/editable in the UI. */
  supportsBaseUrl: boolean;
  /** Whether a Base URL is mandatory (custom endpoints). */
  requiresBaseUrl: boolean;
  defaultModel: string;
  /**
   * How the Settings model field is presented:
   * - `list`: a fixed dropdown of {@link models} (well-known providers).
   * - `freeform`: a text input; the user copies an exact id from the docs.
   */
  modelSelection: 'list' | 'freeform';
  /** Selectable models for `list` providers (ignored for `freeform`). */
  models: string[];
  apiKeyLabel: string;
  /** Where the user obtains a key. */
  docsUrl: string;
  /** Where the user finds valid model ids (for `freeform` providers). */
  modelsDocUrl: string;
}
