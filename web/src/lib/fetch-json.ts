import { refreshAuthStatus } from './auth-status.js';

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    if (response.status === 401) {
      // Token rejected by platform — refresh auth status so the UI flips to signed-out.
      void refreshAuthStatus();
    }
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
