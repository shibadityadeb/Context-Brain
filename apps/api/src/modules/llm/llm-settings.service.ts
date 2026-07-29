/**
 * LLM provider settings — per-user configuration for future multi-provider
 * support. Stores the user's chosen provider + an encrypted API key, tests
 * credentials, and exposes {@link getCurrentLLMProvider} as the seam a future
 * feature will call to run on the user's provider.
 *
 * This does NOT change how Brain works today: Brain still uses Codex. Nothing
 * here is wired into any Codex code path.
 *
 * Security: the API key is encrypted at rest (AES-256-GCM) and is NEVER
 * returned to the client or written to logs.
 */

import type { PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from '@company-brain/auth';
import {
  createConfiguredProvider,
  PROVIDER_CATALOG,
  PROVIDER_CATALOG_LIST,
  ProviderConfigError,
  type ConfiguredLLMProvider,
  type ConfiguredProviderId,
  type ConnectionResult,
  type ProviderCatalogEntry,
} from '@company-brain/llm';
import { connectorEncryptionKey } from '../connectors/google-oauth.js';
import { BadRequestError } from '../../utils/errors.js';

/** Client-safe view of the saved config — never includes the key itself. */
export interface LlmSettingsView {
  configured: boolean;
  provider: ConfiguredProviderId | null;
  baseUrl: string | null;
  model: string | null;
  hasKey: boolean;
  updatedAt: string | null;
}

export class LlmSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Provider metadata for rendering the Settings form. */
  catalog(): ProviderCatalogEntry[] {
    return PROVIDER_CATALOG_LIST;
  }

  async get(userId: string): Promise<LlmSettingsView> {
    const row = await this.prisma.llmProviderSetting.findUnique({ where: { userId } });
    if (!row) {
      return {
        configured: false,
        provider: null,
        baseUrl: null,
        model: null,
        hasKey: false,
        updatedAt: null,
      };
    }
    return {
      configured: true,
      provider: row.provider as ConfiguredProviderId,
      baseUrl: row.baseUrl,
      model: row.model,
      hasKey: !!row.apiKeyCipher,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(
    userId: string,
    input: {
      provider: ConfiguredProviderId;
      apiKey?: string;
      baseUrl?: string | null;
      model?: string;
    },
  ): Promise<LlmSettingsView> {
    const entry = PROVIDER_CATALOG[input.provider];
    const existing = await this.prisma.llmProviderSetting.findUnique({ where: { userId } });

    // A new key is required on first save or when switching providers; keeping
    // the old key only makes sense when the provider is unchanged (keys are
    // provider-specific, so never carry one across providers).
    let apiKeyCipher: string | null = null;
    if (input.apiKey) {
      apiKeyCipher = encryptSecret(input.apiKey, connectorEncryptionKey());
    } else if (existing && existing.provider === input.provider) {
      apiKeyCipher = existing.apiKeyCipher;
    }
    if (!apiKeyCipher) throw new BadRequestError('An API key is required.');

    const baseUrl = entry.supportsBaseUrl ? input.baseUrl?.trim() || null : null;
    if (entry.requiresBaseUrl && !baseUrl) {
      throw new BadRequestError(`${entry.label} requires a base URL.`);
    }

    const model = input.model?.trim() || entry.defaultModel;
    if (!model) throw new BadRequestError(`${entry.label} requires a model.`);

    const row = await this.prisma.llmProviderSetting.upsert({
      where: { userId },
      create: { userId, provider: input.provider, apiKeyCipher, baseUrl, model },
      update: { provider: input.provider, apiKeyCipher, baseUrl, model },
    });
    return {
      configured: true,
      provider: row.provider as ConfiguredProviderId,
      baseUrl: row.baseUrl,
      model: row.model,
      hasKey: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async remove(userId: string): Promise<{ deleted: boolean }> {
    await this.prisma.llmProviderSetting.deleteMany({ where: { userId } });
    return { deleted: true };
  }

  /**
   * Verify credentials with a lightweight provider request. Uses the values in
   * `input` where present, otherwise falls back to the stored config (so the
   * user can test a saved provider without re-entering the key).
   */
  async test(
    userId: string,
    input: {
      provider?: ConfiguredProviderId;
      apiKey?: string;
      baseUrl?: string | null;
      model?: string;
    },
  ): Promise<ConnectionResult> {
    const stored = await this.prisma.llmProviderSetting.findUnique({ where: { userId } });
    const provider = input.provider ?? (stored?.provider as ConfiguredProviderId | undefined);
    if (!provider) throw new BadRequestError('Select a provider to test.');

    // Stored key/baseUrl/model only apply when testing the same provider.
    const sameAsStored = !!stored && stored.provider === provider;
    const apiKey =
      input.apiKey ??
      (sameAsStored ? decryptSecret(stored.apiKeyCipher, connectorEncryptionKey()) : undefined);
    if (!apiKey) throw new BadRequestError('Enter an API key to test.');

    const entry = PROVIDER_CATALOG[provider];
    const baseUrl = entry.supportsBaseUrl
      ? (input.baseUrl?.trim() ?? (sameAsStored ? stored.baseUrl : null) ?? undefined)
      : undefined;
    const model = input.model?.trim() || (sameAsStored ? stored.model : '') || entry.defaultModel;

    try {
      const client = createConfiguredProvider(provider, { apiKey, baseUrl, model });
      return await client.testConnection();
    } catch (err) {
      if (err instanceof ProviderConfigError) throw new BadRequestError(err.message);
      throw err;
    }
  }

  /**
   * The future seam: return the user's configured provider ready to run, or
   * `null` when they haven't configured one. Not yet called by Brain — wiring
   * Brain to it later is a one-line change at the call site.
   */
  async getCurrentLLMProvider(userId: string): Promise<ConfiguredLLMProvider | null> {
    const row = await this.prisma.llmProviderSetting.findUnique({ where: { userId } });
    if (!row) return null;
    const apiKey = decryptSecret(row.apiKeyCipher, connectorEncryptionKey());
    return createConfiguredProvider(row.provider as ConfiguredProviderId, {
      apiKey,
      baseUrl: row.baseUrl,
      model: row.model,
    });
  }
}
