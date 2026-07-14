import { parseEncryptionKey, type OAuthClientConfig } from '@company-brain/auth';
import { GOOGLE_OAUTH_ENDPOINTS } from '@company-brain/connector-google';
import { BadRequestError } from '../../utils/errors.js';
import { config } from '../../config/index.js';

/** Google OAuth client config shared by sign-in and connector code. */
export function googleOAuthConfig(): OAuthClientConfig {
  const { clientId, clientSecret, redirectUri } = config.connectors.google;
  if (!clientId || !clientSecret) {
    throw new BadRequestError(
      'Google OAuth is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
    );
  }
  return { clientId, clientSecret, redirectUri, endpoints: GOOGLE_OAUTH_ENDPOINTS };
}

/** Refresh-token encryption key; required before any credential is stored. */
export function connectorEncryptionKey(): Buffer {
  if (!config.connectors.tokenEncryptionKey) {
    throw new BadRequestError('TOKEN_ENCRYPTION_KEY is not configured');
  }
  return parseEncryptionKey(config.connectors.tokenEncryptionKey);
}
