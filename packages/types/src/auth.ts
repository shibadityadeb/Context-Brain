export const ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE', 'SERVICE'] as const;
export type RoleName = (typeof ROLES)[number];

/**
 * Coarse-grained permissions attached to roles. Future phases add their own
 * (e.g. "meetings:read") without changing the auth machinery.
 */
export const PERMISSIONS = [
  'org:manage',
  'org:read',
  'project:manage',
  'project:read',
  'user:manage',
  'user:read',
  'apikey:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  ADMIN: [
    'org:manage',
    'org:read',
    'project:manage',
    'project:read',
    'user:manage',
    'user:read',
    'apikey:manage',
    'audit:read',
  ],
  MANAGER: ['org:read', 'project:manage', 'project:read', 'user:read', 'audit:read'],
  EMPLOYEE: ['org:read', 'project:read', 'user:read'],
  SERVICE: ['org:read', 'project:read'],
};

export interface AccessTokenPayload {
  /** User id (subject). */
  sub: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  /** Session id backing this refresh token; enables server-side revocation. */
  sid: string;
  type: 'refresh';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
