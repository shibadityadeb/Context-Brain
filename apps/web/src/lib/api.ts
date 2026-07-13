import type { ApiResponse, AuthTokens, HealthReport, UserProfile } from '@company-brain/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'brain.accessToken';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: ApiResponse['errors'],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retryOn401 = true): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // Send the httpOnly refresh cookie along with every auth request.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (response.status === 401 && retryOn401 && !path.startsWith('/api/v1/auth/')) {
    // Access token expired — rotate via the refresh cookie and retry once.
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
  }

  if (!response.ok || !body?.success) {
    throw new ApiRequestError(
      body?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.errors ?? null,
    );
  }
  return body.data as T;
}

type AuthPayload = { user: UserProfile } & AuthTokens;

async function tryRefresh(): Promise<boolean> {
  try {
    const data = await request<AuthPayload>(
      '/api/v1/auth/refresh',
      { method: 'POST', body: JSON.stringify({}) },
      false,
    );
    setAccessToken(data.accessToken);
    return true;
  } catch {
    clearAccessToken();
    return false;
  }
}

export const api = {
  async register(input: { email: string; password: string; name: string }): Promise<AuthPayload> {
    const data = await request<AuthPayload>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAccessToken(data.accessToken);
    return data;
  },

  async login(input: { email: string; password: string }): Promise<AuthPayload> {
    const data = await request<AuthPayload>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAccessToken(data.accessToken);
    return data;
  },

  async logout(): Promise<void> {
    try {
      await request<null>('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } finally {
      clearAccessToken();
    }
  },

  getMe(): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/users/me');
  },

  updateMe(input: { name: string }): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/users/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  getHealth(): Promise<HealthReport> {
    return request<HealthReport>('/health');
  },
};
