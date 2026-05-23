import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProgram, shouldRunMain } from '../../src/cli.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BRAINCTL_API_URL;
  delete process.env.BRAINCTL_API_BASE_URL;
  delete process.env.BRAINCTL_API_TOKEN;
  delete process.env.BRAINCTL_CONFIG_PATH;
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
      await readFile(new URL('../../package.json', import.meta.url), 'utf8')
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

describe('profile snapshot command', () => {
  it('prints snapshot progress messages while creating a profile', async () => {
    const progressWrites: string[] = [];
    const outputWrites: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      progressWrites.push(String(message));
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      outputWrites.push(String(message));
    });
    const program = createProgram({
      profileSnapshotService: {
        async execute(options) {
          options.onProgress?.('Reading claude config and skills…');
          return { profilePath: '/tmp/from-claude/profile.yaml' };
        },
      },
    });

    await program.parseAsync(
      ['node', 'brainctl', 'profile', 'snapshot', '--agent', 'claude', '--as', 'from-claude'],
      { from: 'node' }
    );

    expect(progressWrites).toContain('Reading claude config and skills…');
    expect(outputWrites).toContain('Snapshotted claude into /tmp/from-claude/profile.yaml');

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe('registry profile commands', () => {
  it('manages the shared apiBaseUrl config value', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-cli-config-'));
    tempDirs.push(tempDir);
    process.env.BRAINCTL_CONFIG_PATH = path.join(tempDir, 'config.json');
    const outputWrites: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      outputWrites.push(String(message));
    });
    const program = createProgram();

    await program.parseAsync(
      ['node', 'brainctl', 'config', 'set', 'apiBaseUrl', 'http://127.0.0.1:3877/'],
      { from: 'node' }
    );
    await program.parseAsync(['node', 'brainctl', 'config', 'get', 'apiBaseUrl'], {
      from: 'node',
    });
    await program.parseAsync(['node', 'brainctl', 'config', 'status'], {
      from: 'node',
    });
    await program.parseAsync(['node', 'brainctl', 'config', 'unset', 'apiBaseUrl'], {
      from: 'node',
    });

    expect(outputWrites).toContain('apiBaseUrl=http://127.0.0.1:3877');
    expect(outputWrites).toContain('apiBaseUrl=http://127.0.0.1:3877');
    expect(outputWrites).toContain('source=config');
    expect(outputWrites).toContain('mode=local');
    expect(outputWrites).toContain('unset apiBaseUrl');
    expect(await readFile(process.env.BRAINCTL_CONFIG_PATH, 'utf8')).toContain('{}');
  });

  it('registers a github-hosted profile', async () => {
    process.env.BRAINCTL_API_URL = 'https://api.brainctl.test';
    process.env.BRAINCTL_API_TOKEN = 'token';
    const outputWrites: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      outputWrites.push(String(message));
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ slug: 'review-profile' }), { status: 200 }))
    );
    const program = createProgram();

    await program.parseAsync(
      [
        'node',
        'brainctl',
        'profile',
        'register-github',
        'https://github.com/acme/review-profile',
        '--slug',
        'review-profile',
        '--title',
        'Review Profile',
      ],
      { from: 'node' }
    );

    expect(outputWrites).toContain('Registered GitHub profile "review-profile"');
  });

  it('prints a registry install descriptor', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-registry-config-'));
    tempDirs.push(tempDir);
    process.env.BRAINCTL_CONFIG_PATH = path.join(tempDir, 'config.json');
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      process.env.BRAINCTL_CONFIG_PATH,
      JSON.stringify({ apiBaseUrl: 'https://api.brainctl.test' }),
      'utf8'
    );
    const outputWrites: string[] = [];
    const calls: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      outputWrites.push(String(message));
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url) => {
          calls.push(String(url));
          return (
          new Response(
            JSON.stringify({
              slug: 'review-profile',
              version: '1.0.0',
              source_kind: 'github',
              download_url: 'https://github.com/acme/review-profile/archive/refs/heads/main.tar.gz',
              checksum_sha256: null,
            }),
            { status: 200 }
          )
          );
        }
      )
    );
    const program = createProgram();

    await program.parseAsync(['node', 'brainctl', 'profile', 'install', '--descriptor-only', 'review-profile'], {
      from: 'node',
    });

    expect(outputWrites).toContain('Install descriptor: github');
    expect(calls[0]).toBe('https://api.brainctl.test/profiles/review-profile/install');
  });
});
