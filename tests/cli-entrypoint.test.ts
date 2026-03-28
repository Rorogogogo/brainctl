import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProgram, shouldRunMain } from '../src/cli.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('createProgram version output', () => {
  it('reports the package version for --version', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string };
    const writes: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
    const program = createProgram();

    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'brainctl', '--version'], { from: 'node' })
    ).rejects.toMatchObject({ code: 'commander.version', exitCode: 0 });

    expect(writes).toEqual([`${packageJson.version}\n`]);
    writeSpy.mockRestore();
  });
});
