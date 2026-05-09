import { afterEach, describe, expect, it, vi } from 'vitest';

import { snapshotProfile } from '../../web/src/lib/profile-snapshot.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('snapshotProfile', () => {
  it('reports streamed progress and returns the final profile name', async () => {
    const progress: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ type: 'progress', message: 'Reading claude config and skills…' }),
            JSON.stringify({ type: 'progress', message: 'Writing folder profile to /tmp/profile…' }),
            JSON.stringify({ type: 'result', profileName: 'from-claude', profilePath: '/tmp/profile' }),
          ].join('\n') + '\n',
          {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
          }
        )
      )
    );

    const result = await snapshotProfile({
      agent: 'claude',
      as: 'from-claude',
      onProgress: (message) => progress.push(message),
    });

    expect(progress).toEqual([
      'Reading claude config and skills…',
      'Writing folder profile to /tmp/profile…',
    ]);
    expect(result.profileName).toBe('from-claude');
  });

  it('throws the streamed error event message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`${JSON.stringify({ type: 'error', error: 'snapshot failed' })}\n`, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
        })
      )
    );

    await expect(
      snapshotProfile({
        agent: 'codex',
        onProgress: () => {},
      })
    ).rejects.toThrow('snapshot failed');
  });
});
