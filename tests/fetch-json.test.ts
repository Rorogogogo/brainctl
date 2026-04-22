import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchJson } from '../web/src/lib/fetch-json.js';

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON for ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, name: 'brainctl' }),
      })
    );

    await expect(fetchJson<{ ok: boolean; name: string }>('/api/test')).resolves.toEqual({
      ok: true,
      name: 'brainctl',
    });
  });

  it('throws the API error message for non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'boom' }),
      })
    );

    await expect(fetchJson('/api/test')).rejects.toThrow('boom');
  });

  it('preserves an empty-string error field for non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: '' }),
      })
    );

    try {
      await fetchJson('/api/test');
      throw new Error('expected fetchJson to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('');
    }
  });

  it('falls back to the HTTP status when the error response body is parseable but has no error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 418,
        statusText: "I'm a teapot",
        json: async () => ({ detail: 'short and stout' }),
      })
    );

    await expect(fetchJson('/api/test')).rejects.toThrow('HTTP 418');
  });

  it('falls back to statusText when the error response body cannot be parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => {
          throw new Error('invalid json');
        },
      })
    );

    await expect(fetchJson('/api/test')).rejects.toThrow('Bad Gateway');
  });

  it('preserves an empty-string statusText when the error body cannot be parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: '',
        json: async () => {
          throw new Error('invalid json');
        },
      })
    );

    try {
      await fetchJson('/api/test');
      throw new Error('expected fetchJson to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('');
    }
  });
});
