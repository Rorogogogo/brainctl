import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface UpdateCheckResult {
  current: string;
  latest: string;
  isOutdated: boolean;
  fromCache: boolean;
}

export interface SelfUpdateResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  error?: string;
}

export interface UpdateCheckService {
  check(): Promise<UpdateCheckResult>;
  selfUpdate(): Promise<SelfUpdateResult>;
}

interface UpdateCheckCache {
  lastCheck: string;
  latestVersion: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_DIR = path.join(homedir(), '.brainctl');
const CACHE_PATH = path.join(CACHE_DIR, 'update-check.json');

const packageVersion = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
) as { version: string };

interface UpdateCheckDependencies {
  currentVersion?: string;
  fetchLatestVersion?: () => Promise<string>;
  readCache?: () => Promise<UpdateCheckCache | null>;
  writeCache?: (cache: UpdateCheckCache) => Promise<void>;
  runInstall?: () => Promise<{ success: boolean; error?: string }>;
}

export function createUpdateCheckService(
  dependencies: UpdateCheckDependencies = {}
): UpdateCheckService {
  const currentVersion = dependencies.currentVersion ?? packageVersion.version;
  const fetchLatestVersion = dependencies.fetchLatestVersion ?? fetchFromRegistry;
  const readCacheFn = dependencies.readCache ?? readCacheFile;
  const writeCacheFn = dependencies.writeCache ?? writeCacheFile;
  const runInstall = dependencies.runInstall ?? runNpmInstall;

  return {
    async check(): Promise<UpdateCheckResult> {
      const cached = await readCacheFn();

      if (cached && isCacheValid(cached)) {
        return {
          current: currentVersion,
          latest: cached.latestVersion,
          isOutdated: isNewer(cached.latestVersion, currentVersion),
          fromCache: true,
        };
      }

      let latest: string;
      try {
        latest = await fetchLatestVersion();
      } catch {
        return {
          current: currentVersion,
          latest: currentVersion,
          isOutdated: false,
          fromCache: false,
        };
      }

      await writeCacheFn({
        lastCheck: new Date().toISOString(),
        latestVersion: latest,
      }).catch(() => {});

      return {
        current: currentVersion,
        latest,
        isOutdated: isNewer(latest, currentVersion),
        fromCache: false,
      };
    },

    async selfUpdate(): Promise<SelfUpdateResult> {
      const { success, error } = await runInstall();
      return {
        success,
        fromVersion: currentVersion,
        toVersion: success ? 'latest' : currentVersion,
        error,
      };
    },
  };
}

function isCacheValid(cache: UpdateCheckCache): boolean {
  const lastCheck = new Date(cache.lastCheck).getTime();
  return Date.now() - lastCheck < CACHE_TTL_MS;
}

export function isNewer(candidate: string, baseline: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const [aMaj, aMin, aPat] = parse(candidate);
  const [bMaj, bMin, bPat] = parse(baseline);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

function fetchFromRegistry(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'https://registry.npmjs.org/brainctl/latest',
      { timeout: 3000 },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const pkg = JSON.parse(data) as { version: string };
            resolve(pkg.version);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function readCacheFile(): Promise<UpdateCheckCache | null> {
  try {
    const content = await readFile(CACHE_PATH, 'utf8');
    return JSON.parse(content) as UpdateCheckCache;
  } catch {
    return null;
  }
}

async function writeCacheFile(cache: UpdateCheckCache): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

async function runNpmInstall(): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync('npm', ['install', '-g', 'brainctl@latest'], {
      timeout: 60_000,
    });
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
