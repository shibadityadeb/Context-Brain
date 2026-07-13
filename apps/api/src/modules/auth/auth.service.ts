import { ROLE_PERMISSIONS, type RoleName, type UserProfile } from '@company-brain/types';
import { durationToSeconds } from '@company-brain/utils';
import type { User } from '@prisma/client';
import { config } from '../../config/index.js';
import { ConflictError, UnauthorizedError } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/tokens.js';
import type { AuthRepository } from './auth.repository.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';

export interface AuthResult {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
}

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async register(body: RegisterBody, meta: RequestMeta): Promise<AuthResult> {
    const existing = await this.repo.findUserByEmail(body.email);
    if (existing) throw new ConflictError('An account with this email already exists');

    // Bootstrap: the very first user becomes ADMIN.
    const isFirstUser = (await this.repo.countUsers()) === 0;
    const role: RoleName = isFirstUser ? 'ADMIN' : 'EMPLOYEE';

    const user = await this.repo.createUser({
      email: body.email,
      passwordHash: await hashPassword(body.password),
      name: body.name,
      role,
    });

    if (body.organizationName) {
      await this.repo.createOrganizationWithMembership(user.id, body.organizationName, 'ADMIN');
    }

    await this.repo.writeAuditLog({
      action: 'auth.register',
      actorId: user.id,
      resource: 'user',
      resourceId: user.id,
      ...meta,
    });

    return this.issueTokens(user, meta);
  }

  async login(body: LoginBody, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.repo.findUserByEmail(body.email);
    // Same error for unknown email and wrong password — no user enumeration.
    if (!user || !user.isActive || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password');
    }

    await this.repo.updateLastLogin(user.id);
    await this.repo.writeAuditLog({
      action: 'auth.login',
      actorId: user.id,
      resource: 'user',
      resourceId: user.id,
      ...meta,
    });

    return this.issueTokens(user, meta);
  }

  /**
   * Rotates the refresh token: the presented session is revoked and a new
   * one is issued. Reuse of a revoked token revokes every session for the
   * user (stolen-token containment).
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const payload = verifyRefreshToken(refreshToken);
    const session = await this.repo.findSessionById(payload.sid);

    if (!session || session.refreshTokenHash !== hashToken(refreshToken)) {
      throw new UnauthorizedError('Unknown session');
    }
    if (session.revokedAt) {
      await this.repo.revokeAllUserSessions(session.userId);
      await this.repo.writeAuditLog({
        action: 'auth.refresh_token_reuse',
        actorId: session.userId,
        resource: 'session',
        resourceId: session.id,
        ...meta,
      });
      throw new UnauthorizedError('Session revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedError('Session expired');
    }

    const user = await this.repo.findUserById(session.userId);
    if (!user || !user.isActive) throw new UnauthorizedError('Account is not active');

    await this.repo.revokeSession(session.id);
    return this.issueTokens(user, meta);
  }

  async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
    const payload = verifyRefreshToken(refreshToken);
    const session = await this.repo.findSessionById(payload.sid);
    if (session && !session.revokedAt) {
      await this.repo.revokeSession(session.id);
      await this.repo.writeAuditLog({
        action: 'auth.logout',
        actorId: session.userId,
        resource: 'session',
        resourceId: session.id,
        ...meta,
      });
    }
  }

  private async issueTokens(user: User, meta: RequestMeta): Promise<AuthResult> {
    const refreshTtlSeconds = durationToSeconds(config.jwt.refreshExpiresIn);
    const session = await this.repo.createSession({
      userId: user.id,
      // Placeholder hash; replaced right after the token (which embeds the
      // session id) is signed.
      refreshTokenHash: `pending:${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    const refreshToken = signRefreshToken({ sub: user.id, sid: session.id });
    await this.repo.updateSessionHash(session.id, hashToken(refreshToken));

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role],
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
      refreshToken,
    };
  }
}
