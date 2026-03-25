import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { shouldRunMain } from '../src/cli.js';

const tempDirs: string[] = [];

describe('shouldRunMain', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      })
    );
  });

  it('treats a symlinked binary path as the current module', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-entrypoint-'));
    tempDirs.push(tempDir);

    const realFilePath = path.join(tempDir, 'dist', 'cli.js');
    const linkPath = path.join(tempDir, 'bin', 'brainctl');

    await mkdir(path.dirname(realFilePath), { recursive: true });
    await mkdir(path.dirname(linkPath), { recursive: true });
    await writeFile(realFilePath, '// cli entrypoint', 'utf8');
    await symlink(realFilePath, linkPath);

    expect(
      shouldRunMain(linkPath, pathToFileURL(realFilePath).href)
    ).toBe(true);
  });

  it('returns false for unrelated files', () => {
    expect(
      shouldRunMain('/tmp/other-cli.js', pathToFileURL('/tmp/brainctl.js').href)
    ).toBe(false);
  });
});
