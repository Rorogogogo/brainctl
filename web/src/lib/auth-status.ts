import { useEffect, useRef, useState } from 'react';

export interface AuthStatus {
  signedIn: boolean;
  source?: 'env' | 'config';
  user?: { email?: string; displayName?: string; avatarUrl?: string };
  apiBaseUrl?: string;
  apiMode?: 'local' | 'prod' | 'custom';
  apiSource?: 'flag' | 'env' | 'config' | 'default';
  error?: string;
}

type Listener = (status: AuthStatus | null) => void;

let cache: AuthStatus | null = null;
let inflight: Promise<AuthStatus | null> | null = null;
const listeners = new Set<Listener>();

function broadcast(): void {
  for (const fn of listeners) fn(cache);
}

export async function refreshAuthStatus(): Promise<AuthStatus | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/auth/status');
      cache = (await res.json()) as AuthStatus;
    } catch {
      cache = { signedIn: false };
    }
    broadcast();
    return cache;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function useAuthStatus(): {
  status: AuthStatus | null;
  refresh: () => Promise<AuthStatus | null>;
} {
  const [status, setStatus] = useState<AuthStatus | null>(cache);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener: Listener = (next) => {
      if (mounted.current) setStatus(next);
    };
    listeners.add(listener);
    if (!cache) void refreshAuthStatus();
    return () => {
      mounted.current = false;
      listeners.delete(listener);
    };
  }, []);

  return { status, refresh: refreshAuthStatus };
}
