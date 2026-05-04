import { describe, expect, it } from 'vitest';
import { createRecentProjectsService } from '../../src/services/platform/recent-projects-service.js';

describe('recent-projects service', () => {
  function makeFs(initial: Record<string, string> = {}) {
    const files = new Map(Object.entries(initial));
    return {
      files,
      readFile: async (p: string) => {
        if (!files.has(p)) {
          const err: NodeJS.ErrnoException = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        return files.get(p)!;
      },
      writeFile: async (p: string, content: string) => {
        files.set(p, content);
      },
      mkdir: async () => {},
    };
  }

  it('returns empty list when file is missing', async () => {
    const fs = makeFs();
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.read()).toEqual([]);
  });

  it('reads existing recents preserving order', async () => {
    const fs = makeFs({
      '/tmp/recents.json': JSON.stringify({ version: 1, recents: ['/a', '/b', '/c'] }),
    });
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.read()).toEqual(['/a', '/b', '/c']);
  });

  it('addRecent moves an existing entry to the top', async () => {
    const fs = makeFs({
      '/tmp/recents.json': JSON.stringify({ version: 1, recents: ['/a', '/b', '/c'] }),
    });
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.addRecent('/b')).toEqual(['/b', '/a', '/c']);
  });

  it('addRecent prepends a new entry', async () => {
    const fs = makeFs({});
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.addRecent('/new')).toEqual(['/new']);
  });

  it('caps recents at 20 entries', async () => {
    const initial = Array.from({ length: 20 }, (_, i) => `/p${i}`);
    const fs = makeFs({
      '/tmp/recents.json': JSON.stringify({ version: 1, recents: initial }),
    });
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    const next = await service.addRecent('/new');
    expect(next).toHaveLength(20);
    expect(next[0]).toBe('/new');
    expect(next).not.toContain('/p19');
  });

  it('rejects non-absolute paths', async () => {
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs: makeFs() });
    await expect(service.addRecent('relative/path')).rejects.toThrow(/absolute/);
  });
});
