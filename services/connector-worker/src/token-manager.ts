import type { PrismaClient } from '@prisma/client';
import {
  decryptSecret,
  encryptSecret,
  refreshAccessToken,
  OAuthError,
  type OAuthClientConfig,
} from '@company-brain/auth';
import { TokenExpiredError } from '@company-brain/connector-core';
import { GOOGLE_OAUTH_ENDPOINTS } from '@company-brain/connector-google';
import { config } from './config.js';
import { parseEncryptionKey } from '@company-brain/auth';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Automatic token refresh with in-memory caching. Refresh tokens live
 * encrypted in OAuthCredential; access tokens exist only in this process's
 * memory and are never persisted or exposed. An `invalid_grant` response
 * marks the credential REVOKED and flips the connector to REVOKED so the
 * UI can offer a reconnect flow.
 */
export class TokenManager {
  private readonly cache = new Map<string, CachedToken>();
  private readonly key = parseEncryptionKey(config.encryptionKeyHex);

  constructor(private readonly prisma: PrismaClient) {}

  private oauthConfigFor(provider: string): OAuthClientConfig {
    if (provider === 'GOOGLE_WORKSPACE') {
      return {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        redirectUri: config.google.redirectUri,
        endpoints: GOOGLE_OAUTH_ENDPOINTS,
      };
    }
    throw new Error(`No OAuth configuration for provider ${provider}`);
  }

  encryptRefreshToken(token: string): string {
    return encryptSecret(token, this.key);
  }

  async getAccessToken(connectorId: string): Promise<string> {
    const cached = this.cache.get(connectorId);
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;

    const credential = await this.prisma.oAuthCredential.findFirst({
      where: { connectorId, status: 'ACTIVE', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { connector: { select: { provider: true } } },
    });
    if (!credential) {
      throw new TokenExpiredError('No active credential — reconnect the workspace');
    }

    const refreshToken = decryptSecret(credential.encryptedRefreshToken, this.key);
    try {
      const tokens = await refreshAccessToken(
        this.oauthConfigFor(credential.connector.provider),
        refreshToken,
      );
      const expiresAt = Date.now() + tokens.expiresInSeconds * 1000;
      this.cache.set(connectorId, { accessToken: tokens.accessToken, expiresAt });
      await this.prisma.oAuthCredential.update({
        where: { id: credential.id },
        data: {
          lastRefreshedAt: new Date(),
          accessTokenExpiresAt: new Date(expiresAt),
          // Token rotation: some providers issue a new refresh token.
          ...(tokens.refreshToken
            ? { encryptedRefreshToken: this.encryptRefreshToken(tokens.refreshToken) }
            : {}),
        },
      });
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'invalid_grant') {
        await this.prisma.oAuthCredential.update({
          where: { id: credential.id },
          data: { status: 'REVOKED' },
        });
        await this.prisma.connector.update({
          where: { id: connectorId },
          data: { status: 'REVOKED', error: 'OAuth grant revoked — reconnect required' },
        });
        this.cache.delete(connectorId);
        throw new TokenExpiredError('OAuth grant revoked by the provider');
      }
      throw error;
    }
  }

  invalidate(connectorId: string): void {
    this.cache.delete(connectorId);
  }
}
