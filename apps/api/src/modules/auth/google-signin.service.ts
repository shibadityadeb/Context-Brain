import {
  buildAuthorizationUrl,
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

    const organizationId = await this.resolveOrganization(result.user.id, userinfo);
    if (organizationId) {
      // The sign-in grant carries all workspace scopes: store it and start
      // syncing every connection right away.
      await this.connectors.establishGoogleConnection({
        organizationId,
        userId: result.user.id,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        tokenType: tokens.tokenType,
        scope: tokens.scope,
        profile: { email: userinfo.email, hd: userinfo.hd, name: userinfo.name },
      });
    }

    return result;
  }

  /**
   * Workspace accounts (`hd` set) share one organization per domain, so
   * every colleague who signs in lands in the same brain. Personal
   * accounts get an organization of their own.
   */
  private async resolveOrganization(
    userId: string,
    userinfo: GoogleUserinfo,
  ): Promise<string | null> {
    const membership = await this.repo.findMembership(userId);
    if (membership) return membership.organizationId;

    if (userinfo.hd) {
      const existing = await this.repo.findOrganizationByName(userinfo.hd);
      if (existing) {
        await this.repo.addMembership(userId, existing.id, 'EMPLOYEE');
        return existing.id;
      }
      return this.repo.createOrganizationWithMembership(userId, userinfo.hd, 'ADMIN');
    }

    const name = userinfo.name ?? userinfo.email ?? 'Personal workspace';
    return this.repo.createOrganizationWithMembership(userId, name, 'ADMIN');
  }
}
