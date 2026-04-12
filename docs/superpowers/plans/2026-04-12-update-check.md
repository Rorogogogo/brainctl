# Update Check & Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic update checking so brainctl self-heals stale global installs — auto-updating silently in MCP mode and prompting interactively in CLI mode.

**Architecture:** A new `update-check-service.ts` with dependency-injectable fetch/exec for testability. It caches version lookups in `~/.brainctl/update-check.json` (24h TTL). MCP command runs the check before starting the server; CLI runs it after command execution.

**Tech Stack:** Node.js built-ins only (`node:https`, `node:fs/promises`, `node:child_process`, `node:readline`). No new npm dependencies.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/update-check-service.ts` | Create | Version check against npm registry, cache management, self-update via execFile, re-exec |
| `src/commands/mcp.ts` | Modify | Call update check before starting MCP server; auto-update + re-exec if outdated |
| `src/cli.ts` | Modify | Call update check after command execution; prompt user interactively |
| `tests/update-check-service.test.ts` | Create | Unit tests for check, cache, self-update logic |

---

### Task 1: Update Check Service — version check with cache

**Files:**
- Create: `src/services/update-check-service.ts`
- Create: `tests/update-check-service.test.ts`

- [ ] **Step 1: Write failing test — returns outdated when registry has newer version**

In `tests/update-check-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createUpdateCheckService } from '../src/services/update-check-service.js';

describe('update check service', () => {
  describe('check', () => {
    it('returns outdated when registry has a newer version', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.current).toBe('0.1.7');
      expect(result.latest).toBe('0.2.0');
      expect(result.isOutdated).toBe(true);
      expect(result.fromCache).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

In `src/services/update-check-service.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import https from 'node:https';

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
  const currentVersion = dependencies.currentVersion ?? getCurrentVersion();
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

      await writeCacheFn({ lastCheck: new Date().toISOString(), latestVersion: latest }).catch(() => {});

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

function getCurrentVersion(): string {
  const { readFileSync } = require('node:fs');
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  ) as { version: string };
  return pkg.version;
}

function fetchFromRegistry(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'https://registry.npmjs.org/brainctl/latest',
      { timeout: 3000 },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
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
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
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
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync('npm', ['install', '-g', 'brainctl@latest'], { timeout: 60_000 });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/update-check-service.ts tests/update-check-service.test.ts
git commit -m "feat: add update-check service with npm registry lookup and 24h cache"
```

---

### Task 2: Update Check Service — cache and edge case tests

**Files:**
- Modify: `tests/update-check-service.test.ts`

- [ ] **Step 1: Write failing test — uses cache when within TTL**

Add to `tests/update-check-service.test.ts` inside `describe('check')`:

```ts
    it('uses cached version when within TTL', async () => {
      const fetchLatestVersion = async () => { throw new Error('should not be called'); };
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion,
        readCache: async () => ({
          lastCheck: new Date().toISOString(),
          latestVersion: '0.2.0',
        }),
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(result.latest).toBe('0.2.0');
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: PASS (implementation already handles this)

- [ ] **Step 3: Write failing test — fetches when cache is expired**

Add to `tests/update-check-service.test.ts` inside `describe('check')`:

```ts
    it('fetches from registry when cache is expired', async () => {
      const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      let cacheWritten: { lastCheck: string; latestVersion: string } | null = null;

      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.3.0',
        readCache: async () => ({
          lastCheck: expired,
          latestVersion: '0.2.0',
        }),
        writeCache: async (cache) => { cacheWritten = cache; },
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.latest).toBe('0.3.0');
      expect(cacheWritten?.latestVersion).toBe('0.3.0');
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test — returns not outdated on network failure**

Add to `tests/update-check-service.test.ts` inside `describe('check')`:

```ts
    it('returns not outdated when fetch fails and no cache', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => { throw new Error('network error'); },
        readCache: async () => null,
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(false);
      expect(result.current).toBe('0.1.7');
      expect(result.latest).toBe('0.1.7');
    });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: PASS

- [ ] **Step 7: Write failing test — not outdated when already on latest**

Add to `tests/update-check-service.test.ts` inside `describe('check')`:

```ts
    it('returns not outdated when already on latest', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.2.0',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(false);
    });
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add tests/update-check-service.test.ts
git commit -m "test: add cache TTL and edge case tests for update-check service"
```

---

### Task 3: Update Check Service — isNewer semver comparison tests

**Files:**
- Modify: `tests/update-check-service.test.ts`

- [ ] **Step 1: Write tests for semver comparison**

Add to `tests/update-check-service.test.ts`:

```ts
import { createUpdateCheckService, isNewer } from '../src/services/update-check-service.js';

describe('isNewer', () => {
  it('returns true for newer major', () => {
    expect(isNewer('2.0.0', '1.0.0')).toBe(true);
  });

  it('returns true for newer minor', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
  });

  it('returns true for newer patch', () => {
    expect(isNewer('0.1.8', '0.1.7')).toBe(true);
  });

  it('returns false for same version', () => {
    expect(isNewer('0.1.7', '0.1.7')).toBe(false);
  });

  it('returns false for older version', () => {
    expect(isNewer('0.1.6', '0.1.7')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: PASS (implementation already exists)

- [ ] **Step 3: Commit**

```bash
git add tests/update-check-service.test.ts
git commit -m "test: add semver comparison tests for isNewer"
```

---

### Task 4: Update Check Service — selfUpdate tests

**Files:**
- Modify: `tests/update-check-service.test.ts`

- [ ] **Step 1: Write failing test — selfUpdate returns success**

Add to `tests/update-check-service.test.ts`:

```ts
  describe('selfUpdate', () => {
    it('returns success when npm install succeeds', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
        runInstall: async () => ({ success: true }),
      });

      const result = await service.selfUpdate();

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe('0.1.7');
    });

    it('returns failure with error when npm install fails', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
        runInstall: async () => ({ success: false, error: 'EACCES' }),
      });

      const result = await service.selfUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toBe('EACCES');
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/update-check-service.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/update-check-service.test.ts
git commit -m "test: add selfUpdate tests for update-check service"
```

---

### Task 5: MCP mode — auto-update before server start

**Files:**
- Modify: `src/commands/mcp.ts`

- [ ] **Step 1: Write the auto-update integration**

Replace `src/commands/mcp.ts` with:

```ts
import type { Command } from 'commander';

import { startMcpServer } from '../mcp/server.js';
import { createUpdateCheckService } from '../services/update-check-service.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Start the brainctl MCP server (stdio transport)')
    .action(async () => {
      if (!process.env.BRAINCTL_NO_UPDATE_CHECK) {
        await autoUpdateIfNeeded();
      }
      await startMcpServer({ cwd: process.cwd() });
    });
}

async function autoUpdateIfNeeded(): Promise<void> {
  try {
    const service = createUpdateCheckService();
    const check = await service.check();

    if (!check.isOutdated) return;

    const result = await service.selfUpdate();

    if (result.success) {
      // Re-exec with the updated binary
      const { execFile } = await import('node:child_process');
      const child = execFile(process.execPath, process.argv.slice(1), {
        stdio: 'inherit',
      });
      child.on('exit', (code) => process.exit(code ?? 0));
      return new Promise(() => {}); // hang until child exits
    }

    // Update failed — log and continue with current version
    if (result.error) {
      process.stderr.write(`brainctl: auto-update failed: ${result.error}\n`);
    }
  } catch {
    // Update check failed entirely — continue silently
  }
}
```

- [ ] **Step 2: Run full test suite to verify nothing is broken**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Manual smoke test**

Run: `npm run build && node dist/cli.js mcp`
Expected: MCP server starts (Ctrl-C to exit). No errors on stderr.

- [ ] **Step 4: Commit**

```bash
git add src/commands/mcp.ts
git commit -m "feat: auto-update brainctl before MCP server starts"
```

---

### Task 6: CLI mode — interactive update prompt

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the update check to main()**

In `src/cli.ts`, add this import at the top with the other imports:

```ts
import { createUpdateCheckService } from './services/update-check-service.js';
```

Then replace the `main()` function:

```ts
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }

  // Skip update check for MCP mode (handled in mcp command), non-TTY, opt-out, or local dev
  const isMcpCommand = argv.includes('mcp');
  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
  const isOptedOut = !!process.env.BRAINCTL_NO_UPDATE_CHECK;
  const isLocalDev = import.meta.url.includes('/src/');

  if (isMcpCommand || !isInteractive || isOptedOut || isLocalDev) return;

  try {
    const service = createUpdateCheckService();
    const check = await service.check();
    if (!check.isOutdated) return;

    const answer = await promptYesNo(
      `\n⚠ brainctl ${check.latest} is available (you have ${check.current}).\n  Update now? [Y/n] `
    );

    if (answer) {
      process.stderr.write('  Updating...\n');
      const result = await service.selfUpdate();
      if (result.success) {
        process.stderr.write(`  Updated to brainctl@${check.latest}\n`);
      } else {
        process.stderr.write(`  Update failed: ${result.error ?? 'unknown error'}\n`);
        process.stderr.write(`  Run manually: npm install -g brainctl\n`);
      }
    }
  } catch {
    // Update check failed — don't interrupt the user
  }
}

function promptYesNo(question: string): Promise<boolean> {
  const { createInterface } = require('node:readline') as typeof import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
    });
  });
}
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Manual smoke test**

Run: `npm run build && node dist/cli.js status`
Expected: Status output prints. If version is current, no prompt. If outdated, prompt appears.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: interactive update prompt in CLI mode"
```

---

### Task 7: Fix getCurrentVersion to use ESM-compatible approach

**Files:**
- Modify: `src/services/update-check-service.ts`

- [ ] **Step 1: Replace require with readFileSync import**

The `getCurrentVersion()` function uses `require('node:fs')` which doesn't work in ESM. Replace it:

```ts
function getCurrentVersion(): string {
  const { readFileSync } = await import('node:fs');
```

Actually, since this is a sync default, read it at module level instead. At the top of `src/services/update-check-service.ts`, after the existing imports:

```ts
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };
```

Then change the `getCurrentVersion` function to:

```ts
function getCurrentVersion(): string {
  return packageVersion.version;
}
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Build check**

Run: `npm run build:server`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/services/update-check-service.ts
git commit -m "fix: use ESM-compatible package version read in update-check service"
```

---

### Task 8: Fix promptYesNo to use ESM-compatible import

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Replace require with top-level import**

In `src/cli.ts`, add to the imports at the top:

```ts
import { createInterface } from 'node:readline';
```

Then update the `promptYesNo` function:

```ts
function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
    });
  });
}
```

- [ ] **Step 2: Build check**

Run: `npm run build:server`
Expected: No TypeScript errors

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "fix: use ESM import for readline in CLI update prompt"
```
