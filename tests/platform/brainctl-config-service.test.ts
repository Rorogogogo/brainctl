import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_BRAINCTL_API_BASE_URL,
  createBrainctlConfigService,
  resolveBrainctlApiTarget,
  resolveBrainctlApiBaseUrl,
} from '../../src/services/platform/brainctl-config-service.js';

let tempDir: string;
let originalConfigPath: string | undefined;
let originalApiBaseUrl: string | undefined;
let originalApiUrl: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-config-'));
  originalConfigPath = process.env.BRAINCTL_CONFIG_PATH;
  originalApiBaseUrl = process.env.BRAINCTL_API_BASE_URL;
  originalApiUrl = process.env.BRAINCTL_API_URL;
  process.env.BRAINCTL_CONFIG_PATH = path.join(tempDir, 'config.json');
  delete process.env.BRAINCTL_API_BASE_URL;
  delete process.env.BRAINCTL_API_URL;
});

afterEach(async () => {
  restoreEnv('BRAINCTL_CONFIG_PATH', originalConfigPath);
  restoreEnv('BRAINCTL_API_BASE_URL', originalApiBaseUrl);
  restoreEnv('BRAINCTL_API_URL', originalApiUrl);
  await rm(tempDir, { recursive: true, force: true });
});

describe('brainctl config service', () => {
  it('persists and unsets apiBaseUrl in the shared config file', async () => {
    const service = createBrainctlConfigService();

    await service.set('apiBaseUrl', 'http://127.0.0.1:3877/');

    expect(await service.get('apiBaseUrl')).toBe('http://127.0.0.1:3877');
    await expect(readFile(process.env.BRAINCTL_CONFIG_PATH as string, 'utf8')).resolves.toContain(
      '"apiBaseUrl": "http://127.0.0.1:3877"'
    );

    await service.unset('apiBaseUrl');

    expect(await service.get('apiBaseUrl')).toBeUndefined();
  });

  it('resolves apiBaseUrl from explicit option, env, config, then default', async () => {
    const configPath = process.env.BRAINCTL_CONFIG_PATH as string;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({ apiBaseUrl: 'http://127.0.0.1:3877' }), 'utf8');

    expect(await resolveBrainctlApiBaseUrl({ apiBaseUrl: 'https://flag.brainctl.test/' })).toBe(
      'https://flag.brainctl.test'
    );

    process.env.BRAINCTL_API_BASE_URL = 'https://env.brainctl.test/';
    expect(await resolveBrainctlApiBaseUrl()).toBe('https://env.brainctl.test');

    delete process.env.BRAINCTL_API_BASE_URL;
    expect(await resolveBrainctlApiBaseUrl()).toBe('http://127.0.0.1:3877');

    await rm(configPath, { force: true });
    expect(await resolveBrainctlApiBaseUrl()).toBe(DEFAULT_BRAINCTL_API_BASE_URL);
  });

  it('reports the active api target source and mode', async () => {
    const configPath = process.env.BRAINCTL_CONFIG_PATH as string;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({ apiBaseUrl: 'http://127.0.0.1:3877' }), 'utf8');

    expect(await resolveBrainctlApiTarget({ apiBaseUrl: 'https://flag.brainctl.test' })).toEqual({
      apiBaseUrl: 'https://flag.brainctl.test',
      source: 'flag',
      mode: 'custom',
    });

    process.env.BRAINCTL_API_BASE_URL = 'https://env.brainctl.test';
    expect(await resolveBrainctlApiTarget()).toEqual({
      apiBaseUrl: 'https://env.brainctl.test',
      source: 'env',
      mode: 'custom',
    });

    delete process.env.BRAINCTL_API_BASE_URL;
    expect(await resolveBrainctlApiTarget()).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3877',
      source: 'config',
      mode: 'local',
    });

    await rm(configPath, { force: true });
    expect(await resolveBrainctlApiTarget()).toEqual({
      apiBaseUrl: DEFAULT_BRAINCTL_API_BASE_URL,
      source: 'default',
      mode: 'prod',
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
