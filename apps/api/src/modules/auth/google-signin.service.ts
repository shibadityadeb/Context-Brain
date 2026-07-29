import {
  buildAuthorizationUrl,
  encryptSecret,
  exchangeAuthorizationCode,
  signState,
  verifyState,
} from '@company-brain/auth';
import { GOOGLE_AUTH_PARAMS, GOOGLE_SCOPES } from '@company-brain/connector-google';
import { config } from '../../config/index.js';
import { UnauthorizedError } from '../../utils/errors.js';
import type { ConnectorApiService } from '../connectors/connector.service.js';
import { connectorEncryptionKey, googleOAuthConfig } from '../connectors/google-oauth.js';
import type { AuthRepository } from './auth.repository.js';
import type { AuthResult, AuthService } from './auth.service.js';

const SIGNIN_PROVIDER = 'google-signin';

interface GoogleUserinfo {
  email?: string;
  email_verified?: boolean;
  hd?: string;
  name?: string;
}

/**
 * The single entry point to the brain: signing in with Google both
 * authenticates the user and automatically establishes the organization's
 * workspace connection from the same OAuth grant — no manual connect step.
 */
export class GoogleSignInService {
  constructor(
    private readonly auth: AuthService,
    private readonly repo: AuthRepository,
    private readonly connectors: ConnectorApiService,
  ) {}

  buildSignInUrl(): string {
    const oauth = googleOAuthConfig();
    connectorEncryptionKey(); // fail early if encryption is not configured
    const state = signState(
      { organizationId: '', userId: '', provider: SIGNIN_PROVIDER },
      config.connectors.stateSecret,
    );
    return buildAuthorizationUrl(oauth, {
      scopes: [...GOOGLE_SCOPES],
      state,
      extraParams: { ...GOOGLE_AUTH_PARAMS },
    });
  }

  async handleCallback(
    code: string,
    state: string,
    meta: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResult> {
    const payload = verifyState(state, config.connectors.stateSecret);
    if (payload.provider !== SIGNIN_PROVIDER) {
      throw new UnauthorizedError('Unexpected OAuth state');
    }

    const oauth = googleOAuthConfig();
    const tokens = await exchangeAuthorizationCode(oauth, code);
    if (!tokens.refreshToken) {
      throw new UnauthorizedError(
        'Google did not return a refresh token — remove prior access at myaccount.google.com/permissions and retry',
      );
    }

    const userinfo = (await (
      await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      })
    ).json()) as GoogleUserinfo;
    if (!userinfo.email) {
      throw new UnauthorizedError('Google did not return an email address');
    }

    const result = await this.auth.loginWithGoogle(
      { email: userinfo.email, name: userinfo.name },
      meta,
    );

    const accessTokenExpiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);
    const profile = { email: userinfo.email, hd: userinfo.hd, name: userinfo.name };
    const active = await this.repo.findActiveMembership(result.user.id);

    if (active) {
      // Returning member — connect straight to their workspace (no onboarding).
      await this.connectors.establishGoogleConnection({
        organizationId: active.organizationId,
        userId: result.user.id,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt,
        tokenType: tokens.tokenType,
        scope: tokens.scope,
        profile,
      });
    } else {
      // New / unattached — stash the grant until they pick a workspace during
      // onboarding, then it auto-establishes with no second consent screen.
      await this.repo.stashPendingGrant(result.user.id, {
        refreshTokenCipher: encryptSecret(tokens.refreshToken, connectorEncryptionKey()),
        scope: tokens.scope,
        tokenType: tokens.tokenType,
        accessTokenExpiresAt,
        profile,
      });
    }

    return result;
  }
}
