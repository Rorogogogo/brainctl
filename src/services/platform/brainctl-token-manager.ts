import {
  createBrainctlConfigService,
  resolveBrainctlApiBaseUrl,
  resolveBrainctlApiToken,
  type BrainctlConfigService,
} from './brainctl-config-service.js';

export interface BrainctlTokenManager {
  /** Return a usable bearer token, refreshing if expired. Returns null when no credentials. */
  getAccessToken(): Promise<string | null>;
  /** Make an authenticated fetch that auto-refreshes on 401 once and retries. */
  authenticatedFetch(
    pathOrUrl: string,
    init?: RequestInit
  ): Promise<Response>;
  /** Persist both tokens after a fresh sign-in. */
  saveTokens(input: { accessToken: string; refreshToken?: string }): Promise<void>;
  /** Clear both tokens. */
  clear(): Promise<void>;
}

interface ManagerDeps {
  configService?: BrainctlConfigService;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
}

export function createBrainctlTokenManager(deps: ManagerDeps = {}): BrainctlTokenManager {
  const config = deps.configService ?? createBrainctlConfigService();
  const fetchImpl = deps.fetch ?? fetch;
  let refreshInFlight: Promise<string | null> | null = null;

  async function apiBase(): Promise<string> {
    return (deps.apiBaseUrl ?? (await resolveBrainctlApiBaseUrl())).replace(/\/$/, '');
  }

  async function readAccessToken(): Promise<string | null> {
    const resolved = await resolveBrainctlApiToken({ configService: config });
    return resolved?.token ?? null;
  }

  async function readRefreshToken(): Promise<string | null> {
    return (await config.get('apiRefreshToken')) ?? null;
  }

  async function refresh(): Promise<string | null> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const refreshToken = await readRefreshToken();
      if (!refreshToken) return null;
      const res = await fetchImpl(`${await apiBase()}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        await config.unset('apiRefreshToken');
        await config.unset('apiToken');
        return null;
      }
      const data = (await res.json()) as { access_token: string; refresh_token?: string };
      await config.set('apiToken', data.access_token);
      if (data.refresh_token) {
        await config.set('apiRefreshToken', data.refresh_token);
      }
      return data.access_token;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  return {
    async getAccessToken() {
      return readAccessToken();
    },

    async saveTokens({ accessToken, refreshToken }) {
      await config.set('apiToken', accessToken);
      if (refreshToken) {
        await config.set('apiRefreshToken', refreshToken);
      }
    },

    async clear() {
      await config.unset('apiToken');
      await config.unset('apiRefreshToken');
    },

    async authenticatedFetch(pathOrUrl, init = {}) {
      const url = pathOrUrl.startsWith('http')
        ? pathOrUrl
        : `${await apiBase()}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

      const buildRequest = (token: string | null) => {
        const headers = new Headers(init.headers);
        if (token) headers.set('authorization', `Bearer ${token}`);
        return fetchImpl(url, { ...init, headers });
      };

      const first = await buildRequest(await readAccessToken());
      if (first.status !== 401) return first;

      const refreshed = await refresh();
      if (!refreshed) return first;
      return buildRequest(refreshed);
    },
  };
}
