import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BRAINCTL_API_BASE_URL = 'https://api.brainctl.net';
export const DEFAULT_BRAINCTL_FRONTEND_URL = 'https://app.brainctl.net';

export type BrainctlConfigKey =
  | 'apiBaseUrl'
  | 'apiToken'
  | 'apiRefreshToken'
  | 'apiFrontendUrl';
export type BrainctlApiTargetSource = 'flag' | 'env' | 'config' | 'default';
export type BrainctlApiTargetMode = 'local' | 'prod' | 'custom';
export type BrainctlApiTokenSource = 'env' | 'config';

export interface BrainctlConfig {
  apiBaseUrl?: string;
  apiToken?: string;
  apiRefreshToken?: string;
  apiFrontendUrl?: string;
}

export interface BrainctlApiTarget {
  apiBaseUrl: string;
  source: BrainctlApiTargetSource;
  mode: BrainctlApiTargetMode;
}

export interface BrainctlConfigService {
  path(): string;
  read(): Promise<BrainctlConfig>;
  get(key: BrainctlConfigKey): Promise<string | undefined>;
  set(key: BrainctlConfigKey, value: string): Promise<void>;
  unset(key: BrainctlConfigKey): Promise<void>;
}

export function createBrainctlConfigService(): BrainctlConfigService {
  return {
    path: brainctlConfigPath,

    async read() {
      return readConfigFile();
    },

    async get(key) {
      const config = await readConfigFile();
      return config[key];
    },

    async set(key, value) {
      const config = await readConfigFile();
      const next = { ...config, [key]: normalizeConfigValue(key, value) };
      await writeConfigFile(next);
    },

    async unset(key) {
      const config = await readConfigFile();
      const next = { ...config };
      delete next[key];
      await writeConfigFile(next);
    },
  };
}

export async function resolveBrainctlApiBaseUrl(
  options: {
    apiBaseUrl?: string;
    env?: NodeJS.ProcessEnv;
    configService?: BrainctlConfigService;
  } = {}
): Promise<string> {
  return (await resolveBrainctlApiTarget(options)).apiBaseUrl;
}

export async function resolveBrainctlApiTarget(
  options: {
    apiBaseUrl?: string;
    env?: NodeJS.ProcessEnv;
    configService?: BrainctlConfigService;
  } = {}
): Promise<BrainctlApiTarget> {
  if (options.apiBaseUrl) {
    return toApiTarget(normalizeApiBaseUrl(options.apiBaseUrl), 'flag');
  }

  const env = options.env ?? process.env;
  const envValue = env.BRAINCTL_API_BASE_URL ?? env.BRAINCTL_API_URL;
  if (envValue) {
    return toApiTarget(normalizeApiBaseUrl(envValue), 'env');
  }

  const configService = options.configService ?? createBrainctlConfigService();
  const configured = await configService.get('apiBaseUrl');
  if (configured) {
    return toApiTarget(normalizeApiBaseUrl(configured), 'config');
  }

  return toApiTarget(DEFAULT_BRAINCTL_API_BASE_URL, 'default');
}

function brainctlConfigPath(): string {
  return (
    process.env.BRAINCTL_CONFIG_PATH ??
    path.join(process.env.BRAINCTL_HOME ?? os.homedir(), '.brainctl', 'config.json')
  );
}

async function readConfigFile(): Promise<BrainctlConfig> {
  const filePath = brainctlConfigPath();
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(source) as Partial<BrainctlConfig> | null;
    return normalizeConfig(parsed);
  } catch (error) {
    throw new Error(`Invalid brainctl config at ${filePath}: ${(error as Error).message}`);
  }
}

async function writeConfigFile(config: BrainctlConfig): Promise<void> {
  const filePath = brainctlConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function normalizeConfig(value: Partial<BrainctlConfig> | null): BrainctlConfig {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return {
    ...(typeof value.apiBaseUrl === 'string' && value.apiBaseUrl.trim()
      ? { apiBaseUrl: normalizeApiBaseUrl(value.apiBaseUrl) }
      : {}),
    ...(typeof value.apiFrontendUrl === 'string' && value.apiFrontendUrl.trim()
      ? { apiFrontendUrl: normalizeApiBaseUrl(value.apiFrontendUrl) }
      : {}),
    ...(typeof value.apiToken === 'string' && value.apiToken.trim()
      ? { apiToken: value.apiToken.trim() }
      : {}),
    ...(typeof value.apiRefreshToken === 'string' && value.apiRefreshToken.trim()
      ? { apiRefreshToken: value.apiRefreshToken.trim() }
      : {}),
  };
}

function normalizeConfigValue(key: BrainctlConfigKey, value: string): string {
  if (key === 'apiBaseUrl' || key === 'apiFrontendUrl') {
    return normalizeApiBaseUrl(value);
  }
  if (key === 'apiToken' || key === 'apiRefreshToken') {
    const trimmed = value.trim();
    if (!trimmed) throw new Error(`${key} cannot be empty.`);
    return trimmed;
  }
  throw new Error(`Unsupported config key "${key}".`);
}

export async function resolveBrainctlApiToken(
  options: {
    env?: NodeJS.ProcessEnv;
    configService?: BrainctlConfigService;
  } = {}
): Promise<{ token: string; source: BrainctlApiTokenSource } | null> {
  const env = options.env ?? process.env;
  if (env.BRAINCTL_API_TOKEN && env.BRAINCTL_API_TOKEN.trim().length > 0) {
    return { token: env.BRAINCTL_API_TOKEN.trim(), source: 'env' };
  }
  const configService = options.configService ?? createBrainctlConfigService();
  const stored = await configService.get('apiToken');
  if (stored && stored.trim().length > 0) {
    return { token: stored.trim(), source: 'config' };
  }
  return null;
}

export async function resolveBrainctlFrontendUrl(
  options: {
    env?: NodeJS.ProcessEnv;
    configService?: BrainctlConfigService;
    apiBaseUrl?: string;
  } = {}
): Promise<string> {
  const env = options.env ?? process.env;
  if (env.BRAINCTL_FRONTEND_URL && env.BRAINCTL_FRONTEND_URL.trim().length > 0) {
    return normalizeApiBaseUrl(env.BRAINCTL_FRONTEND_URL);
  }
  const configService = options.configService ?? createBrainctlConfigService();
  const stored = await configService.get('apiFrontendUrl');
  if (stored) return normalizeApiBaseUrl(stored);
  if (options.apiBaseUrl) {
    try {
      const url = new URL(options.apiBaseUrl);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return `${url.protocol}//${url.hostname}:5173`;
      }
      if (url.hostname.startsWith('api.')) {
        return `${url.protocol}//app.${url.hostname.slice('api.'.length)}`;
      }
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_BRAINCTL_FRONTEND_URL;
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('apiBaseUrl cannot be empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid apiBaseUrl "${value}". Use an http:// or https:// URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid apiBaseUrl "${value}". Use an http:// or https:// URL.`);
  }

  return trimmed;
}

function toApiTarget(apiBaseUrl: string, source: BrainctlApiTargetSource): BrainctlApiTarget {
  return {
    apiBaseUrl,
    source,
    mode: detectApiTargetMode(apiBaseUrl),
  };
}

function detectApiTargetMode(apiBaseUrl: string): BrainctlApiTargetMode {
  if (apiBaseUrl === DEFAULT_BRAINCTL_API_BASE_URL) {
    return 'prod';
  }

  const { hostname } = new URL(apiBaseUrl);
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return 'local';
  }

  return 'custom';
}
