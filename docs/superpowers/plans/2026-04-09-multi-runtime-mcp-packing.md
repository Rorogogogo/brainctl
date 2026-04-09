# Multi-Runtime MCP Packing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the portable profile pack pipeline to detect, classify, and bundle MCP servers across 6 runtimes (node, python, java, go, rust, binary) so packed archives are fully self-contained.

**Architecture:** Add a runtime detector module that maps command names to runtimes, extracts entrypoints from args, and walks up to find project roots via marker files. The classifier delegates to this detector instead of its hardcoded `LOCAL_SCRIPT_RUNNERS` set. Pack service uses `exclude` patterns from detection (instead of hardcoded `node_modules` filter). Types gain `McpRuntime`, `runtime`, and `exclude` fields on `LocalBundledMcpServerConfig`.

**Tech Stack:** TypeScript, Node.js, Vitest, existing brainctl services

---

### Task 1: Add `McpRuntime` type and update `LocalBundledMcpServerConfig`

**Files:**
- Modify: `src/types.ts:112-120`

- [ ] **Step 1: Write the type changes**

In `src/types.ts`, add the `McpRuntime` type before the `LocalBundledMcpServerConfig` interface and add `runtime` and `exclude` fields:

```ts
export type McpRuntime = 'node' | 'python' | 'java' | 'go' | 'rust' | 'binary';

export interface LocalBundledMcpServerConfig {
  kind: 'local';
  source: 'bundled';
  runtime: McpRuntime;
  path: string;
  install?: string;
  command: string;
  args?: string[];
  exclude?: string[];
  env?: Record<string, string>;
}
```

- [ ] **Step 2: Run build to verify types compile**

Run: `npx tsc --noEmit`
Expected: Errors in `portable-mcp-classifier.ts` and `portable-profile-pack-service.ts` because existing bundled return values don't include `runtime`. This is expected — we'll fix them in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add McpRuntime type and runtime/exclude fields to bundled config"
```

---

### Task 2: Create the runtime detector module with tests

**Files:**
- Create: `src/services/runtime-detector.ts`
- Create: `tests/runtime-detector.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/runtime-detector.test.ts`:

```ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  detectMcpRuntime,
  extractEntrypoint,
  findProjectRoot,
  getDefaultInstall,
  getDefaultExclude,
} from '../src/services/runtime-detector.js';

describe('detectMcpRuntime', () => {
  it.each([
    ['node', 'node'],
    ['nodejs', 'node'],
    ['python', 'python'],
    ['python3', 'python'],
    ['java', 'java'],
    ['go', 'go'],
    ['cargo', 'rust'],
  ] as const)('maps command "%s" to runtime "%s"', (command, expected) => {
    expect(detectMcpRuntime(command)).toBe(expected);
  });

  it('returns "binary" for path-like commands', () => {
    expect(detectMcpRuntime('./server')).toBe('binary');
    expect(detectMcpRuntime('/usr/local/bin/mcp')).toBe('binary');
  });

  it('returns null for unrecognized commands', () => {
    expect(detectMcpRuntime('npx')).toBeNull();
    expect(detectMcpRuntime('uvx')).toBeNull();
    expect(detectMcpRuntime('docker')).toBeNull();
  });
});

describe('extractEntrypoint', () => {
  it('extracts first non-flag arg for node/python', () => {
    expect(extractEntrypoint('node', ['--inspect', 'src/index.js'])).toBe('src/index.js');
    expect(extractEntrypoint('python', ['-u', 'server.py'])).toBe('server.py');
  });

  it('extracts arg after -jar for java', () => {
    expect(extractEntrypoint('java', ['-jar', 'server.jar'])).toBe('server.jar');
    expect(extractEntrypoint('java', ['-Xmx512m', '-jar', 'app.jar'])).toBe('app.jar');
  });

  it('returns null for java without -jar', () => {
    expect(extractEntrypoint('java', ['-cp', 'lib/*', 'com.Main'])).toBeNull();
  });

  it('extracts arg after "run" for go', () => {
    expect(extractEntrypoint('go', ['run', './cmd/server'])).toBe('./cmd/server');
  });

  it('returns null for go without run subcommand', () => {
    expect(extractEntrypoint('go', ['build', './cmd/server'])).toBeNull();
  });

  it('returns null for cargo (uses Cargo.toml discovery)', () => {
    expect(extractEntrypoint('cargo', ['run'])).toBeNull();
  });

  it('returns the command itself for binary-style paths', () => {
    expect(extractEntrypoint('./server', [])).toBe('./server');
    expect(extractEntrypoint('/usr/local/bin/mcp', [])).toBe('/usr/local/bin/mcp');
  });

  it('returns null when no entrypoint can be extracted', () => {
    expect(extractEntrypoint('node', [])).toBeNull();
    expect(extractEntrypoint('node', ['--inspect'])).toBeNull();
  });
});

describe('findProjectRoot', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempProject(marker: string, depth: number = 0): { root: string; entrypoint: string } {
    const root = mkdtempSync(path.join(os.tmpdir(), 'brainctl-rt-'));
    tempDirs.push(root);
    writeFileSync(path.join(root, marker), '', 'utf8');

    let entrypointDir = root;
    for (let i = 0; i < depth; i++) {
      entrypointDir = path.join(entrypointDir, `sub${i}`);
      mkdirSync(entrypointDir, { recursive: true });
    }
    const entrypoint = path.join(entrypointDir, 'main.js');
    writeFileSync(entrypoint, '', 'utf8');

    return { root, entrypoint };
  }

  it('finds package.json for node', () => {
    const { root, entrypoint } = makeTempProject('package.json', 2);
    const result = findProjectRoot(entrypoint, 'node');
    expect(result).toEqual({ root, marker: 'package.json' });
  });

  it('finds pyproject.toml for python', () => {
    const { root, entrypoint } = makeTempProject('pyproject.toml', 1);
    const result = findProjectRoot(entrypoint, 'python');
    expect(result).toEqual({ root, marker: 'pyproject.toml' });
  });

  it('finds requirements.txt for python when no pyproject.toml', () => {
    const { root, entrypoint } = makeTempProject('requirements.txt', 1);
    const result = findProjectRoot(entrypoint, 'python');
    expect(result).toEqual({ root, marker: 'requirements.txt' });
  });

  it('finds go.mod for go', () => {
    const { root, entrypoint } = makeTempProject('go.mod', 2);
    const result = findProjectRoot(entrypoint, 'go');
    expect(result).toEqual({ root, marker: 'go.mod' });
  });

  it('finds Cargo.toml for rust', () => {
    const { root, entrypoint } = makeTempProject('Cargo.toml', 1);
    const result = findProjectRoot(entrypoint, 'rust');
    expect(result).toEqual({ root, marker: 'Cargo.toml' });
  });

  it('finds pom.xml for java', () => {
    const { root, entrypoint } = makeTempProject('pom.xml', 1);
    const result = findProjectRoot(entrypoint, 'java');
    expect(result).toEqual({ root, marker: 'pom.xml' });
  });

  it('finds build.gradle for java', () => {
    const { root, entrypoint } = makeTempProject('build.gradle', 1);
    const result = findProjectRoot(entrypoint, 'java');
    expect(result).toEqual({ root, marker: 'build.gradle' });
  });

  it('returns entrypoint directory when no marker found', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'brainctl-rt-'));
    tempDirs.push(root);
    const subdir = path.join(root, 'deep', 'nested');
    mkdirSync(subdir, { recursive: true });
    const entrypoint = path.join(subdir, 'server.py');
    writeFileSync(entrypoint, '', 'utf8');

    const result = findProjectRoot(entrypoint, 'python');
    expect(result).toEqual({ root: subdir, marker: null });
  });

  it('returns entrypoint directory for binary runtime', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'brainctl-rt-'));
    tempDirs.push(root);
    const entrypoint = path.join(root, 'server');
    writeFileSync(entrypoint, '', 'utf8');

    const result = findProjectRoot(entrypoint, 'binary');
    expect(result).toEqual({ root, marker: null });
  });

  it('does not walk more than 5 levels up', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'brainctl-rt-'));
    tempDirs.push(root);
    writeFileSync(path.join(root, 'package.json'), '', 'utf8');
    let deep = root;
    for (let i = 0; i < 6; i++) {
      deep = path.join(deep, `d${i}`);
    }
    mkdirSync(deep, { recursive: true });
    const entrypoint = path.join(deep, 'index.js');
    writeFileSync(entrypoint, '', 'utf8');

    const result = findProjectRoot(entrypoint, 'node');
    expect(result.marker).toBeNull();
  });
});

describe('getDefaultInstall', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns "npm install" for node', () => {
    expect(getDefaultInstall('node', 'package.json', '/tmp')).toBe('npm install');
  });

  it('returns "pip install -r requirements.txt" for python with requirements.txt', () => {
    expect(getDefaultInstall('python', 'requirements.txt', '/tmp')).toBe('pip install -r requirements.txt');
  });

  it('returns "uv sync" for python with pyproject.toml when uv.lock exists', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'brainctl-rt-'));
    tempDirs.push(root);
    writeFileSync(path.join(root, 'pyproject.toml'), '', 'utf8');
    writeFileSync(path.join(root, 'uv.lock'), '', 'utf8');

    expect(getDefaultInstall('python', 'pyproject.toml', root)).toBe('uv sync');
  });

  it('returns "pip install -e ." for python with pyproject.toml when no uv.lock', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'brainctl-rt-'));
    tempDirs.push(root);
    writeFileSync(path.join(root, 'pyproject.toml'), '', 'utf8');

    expect(getDefaultInstall('python', 'pyproject.toml', root)).toBe('pip install -e .');
  });

  it('returns undefined for java .jar entrypoint', () => {
    expect(getDefaultInstall('java', null, '/tmp', 'server.jar')).toBeUndefined();
  });

  it('returns "mvn package -q" for java with pom.xml', () => {
    expect(getDefaultInstall('java', 'pom.xml', '/tmp')).toBe('mvn package -q');
  });

  it('returns "gradle build" for java with build.gradle', () => {
    expect(getDefaultInstall('java', 'build.gradle', '/tmp')).toBe('gradle build');
  });

  it('returns "go build ./..." for go', () => {
    expect(getDefaultInstall('go', 'go.mod', '/tmp')).toBe('go build ./...');
  });

  it('returns "cargo build --release" for rust', () => {
    expect(getDefaultInstall('rust', 'Cargo.toml', '/tmp')).toBe('cargo build --release');
  });

  it('returns undefined for binary', () => {
    expect(getDefaultInstall('binary', null, '/tmp')).toBeUndefined();
  });
});

describe('getDefaultExclude', () => {
  it('returns ["node_modules"] for node', () => {
    expect(getDefaultExclude('node')).toEqual(['node_modules']);
  });

  it('returns python exclusions for python', () => {
    expect(getDefaultExclude('python')).toEqual(['.venv', '__pycache__', '*.pyc']);
  });

  it('returns ["target"] for rust', () => {
    expect(getDefaultExclude('rust')).toEqual(['target']);
  });

  it('returns ["target"] for java with pom.xml', () => {
    expect(getDefaultExclude('java', 'pom.xml')).toEqual(['target']);
  });

  it('returns ["build"] for java with build.gradle', () => {
    expect(getDefaultExclude('java', 'build.gradle')).toEqual(['build']);
  });

  it('returns undefined for binary', () => {
    expect(getDefaultExclude('binary')).toBeUndefined();
  });

  it('returns undefined for go', () => {
    expect(getDefaultExclude('go')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/runtime-detector.test.ts`
Expected: FAIL because `src/services/runtime-detector.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/services/runtime-detector.ts`:

```ts
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { McpRuntime } from '../types.js';

const COMMAND_RUNTIME_MAP: Record<string, McpRuntime> = {
  node: 'node',
  nodejs: 'node',
  python: 'python',
  python3: 'python',
  java: 'java',
  go: 'go',
  cargo: 'rust',
};

const RUNTIME_MARKERS: Record<McpRuntime, string[]> = {
  node: ['package.json'],
  python: ['pyproject.toml', 'requirements.txt', 'setup.py'],
  java: ['pom.xml', 'build.gradle'],
  go: ['go.mod'],
  rust: ['Cargo.toml'],
  binary: [],
};

const MAX_WALK_DEPTH = 5;

export function detectMcpRuntime(command: string): McpRuntime | null {
  const basename = path.basename(command);
  const mapped = COMMAND_RUNTIME_MAP[basename];
  if (mapped) {
    return mapped;
  }

  if (command.startsWith('./') || command.startsWith('/') || command.startsWith('.\\')) {
    return 'binary';
  }

  return null;
}

export function extractEntrypoint(command: string, args: string[]): string | null {
  const runtime = detectMcpRuntime(command);

  if (runtime === 'binary') {
    return command;
  }

  if (runtime === 'java') {
    const jarIndex = args.indexOf('-jar');
    if (jarIndex !== -1 && jarIndex + 1 < args.length) {
      return args[jarIndex + 1];
    }
    return null;
  }

  if (runtime === 'go') {
    const runIndex = args.indexOf('run');
    if (runIndex !== -1 && runIndex + 1 < args.length) {
      return args[runIndex + 1];
    }
    return null;
  }

  if (runtime === 'rust') {
    return null;
  }

  // node, python: first non-flag arg
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      return arg;
    }
  }

  return null;
}

export function findProjectRoot(
  entrypointPath: string,
  runtime: McpRuntime
): { root: string; marker: string | null } {
  const markers = RUNTIME_MARKERS[runtime];
  if (markers.length === 0) {
    return { root: path.dirname(entrypointPath), marker: null };
  }

  let current = path.dirname(entrypointPath);
  for (let depth = 0; depth <= MAX_WALK_DEPTH; depth++) {
    for (const marker of markers) {
      if (existsSync(path.join(current, marker))) {
        return { root: current, marker };
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return { root: path.dirname(entrypointPath), marker: null };
}

export function getDefaultInstall(
  runtime: McpRuntime,
  marker: string | null,
  projectRoot: string,
  entrypoint?: string
): string | undefined {
  switch (runtime) {
    case 'node':
      return 'npm install';
    case 'python':
      if (marker === 'requirements.txt') {
        return 'pip install -r requirements.txt';
      }
      if (marker === 'pyproject.toml') {
        return existsSync(path.join(projectRoot, 'uv.lock')) ? 'uv sync' : 'pip install -e .';
      }
      return undefined;
    case 'java':
      if (entrypoint && entrypoint.endsWith('.jar')) {
        return undefined;
      }
      if (marker === 'pom.xml') return 'mvn package -q';
      if (marker === 'build.gradle') return 'gradle build';
      return undefined;
    case 'go':
      return 'go build ./...';
    case 'rust':
      return 'cargo build --release';
    case 'binary':
      return undefined;
  }
}

export function getDefaultExclude(
  runtime: McpRuntime,
  marker?: string | null
): string[] | undefined {
  switch (runtime) {
    case 'node':
      return ['node_modules'];
    case 'python':
      return ['.venv', '__pycache__', '*.pyc'];
    case 'rust':
      return ['target'];
    case 'java':
      if (marker === 'build.gradle') return ['build'];
      if (marker === 'pom.xml') return ['target'];
      return undefined;
    case 'go':
      return undefined;
    case 'binary':
      return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/runtime-detector.test.ts`
Expected: PASS for all tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/runtime-detector.ts tests/runtime-detector.test.ts
git commit -m "feat: add multi-runtime detector for MCP packing"
```

---

### Task 3: Update classifier to use runtime detector

**Files:**
- Modify: `src/services/portable-mcp-classifier.ts`
- Modify: `tests/portable-mcp-classifier.test.ts`

- [ ] **Step 1: Add new tests for multi-runtime classification**

Append these tests to the existing `describe('classifyPortableMcp')` block in `tests/portable-mcp-classifier.test.ts`:

```ts
  it('classifies python script-runner entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'py-tool',
      entry: {
        command: 'python',
        args: ['./src/server.py'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'python',
      path: path.join(cwd, 'src'),
      command: 'python',
      args: ['./src/server.py'],
    });
  });

  it('classifies java -jar entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'java-tool',
      entry: {
        command: 'java',
        args: ['-jar', './dist/server.jar'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'java',
      path: path.join(cwd, 'dist'),
      command: 'java',
      args: ['-jar', './dist/server.jar'],
    });
  });

  it('classifies go run entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'go-tool',
      entry: {
        command: 'go',
        args: ['run', './cmd/server'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'go',
      path: path.join(cwd, 'cmd', 'server'),
      command: 'go',
      args: ['run', './cmd/server'],
    });
  });

  it('classifies cargo run entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'rust-tool',
      entry: {
        command: 'cargo',
        args: ['run'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'rust',
      path: cwd,
      command: 'cargo',
      args: ['run'],
    });
  });

  it('classifies relative path commands as bundled binary', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'bin-tool',
      entry: {
        command: './dist/server',
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'binary',
      path: path.join(cwd, 'dist'),
      command: './dist/server',
    });
  });

  it('classifies uvx as npm-like package runner', () => {
    const result = classifyPortableMcp({
      cwd: '/workspace/project',
      key: 'uv-tool',
      entry: {
        command: 'uvx',
        args: ['mcp-server-fetch'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'npm',
      package: 'mcp-server-fetch',
    });
  });

  it('adds runtime field to existing node bundled classification', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'custom-tool',
      entry: {
        command: 'node',
        args: ['./dist/index.js'],
      },
    });

    expect(result).toMatchObject({
      kind: 'local',
      source: 'bundled',
      runtime: 'node',
    });
  });
```

- [ ] **Step 2: Update existing tests that need adjustment**

In `tests/portable-mcp-classifier.test.ts`:

Update the test `'classifies script-runner entries with a local entrypoint as bundled MCPs'` (around line 68) to expect `runtime: 'node'`:

```ts
    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'node',
      path: path.join(cwd, 'dist'),
      command: 'node',
      args: ['./dist/index.js'],
    });
```

Update the test `'rejects ambiguous live entries that cannot be safely packed'` (around line 150) — `uvx` is now handled as npm-like, so change to test a truly unknown command:

```ts
  it('rejects ambiguous live entries that cannot be safely packed', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: 'unknown-tool',
        entry: {
          command: 'docker',
          args: ['run', 'my-image'],
        },
      })
    ).toThrowError(
      'MCP "unknown-tool" cannot be packed: unrecognized command "docker".'
    );
  });
```

Update the test `'rejects absolute command-path launchers'` (around line 165) — absolute paths outside project still reject:

```ts
  it('rejects absolute command paths outside the project', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: path.join(path.sep, 'workspace', 'project'),
        key: 'system-tool',
        entry: {
          command: '/usr/local/bin/tool',
        },
      })
    ).toThrowError(PortableMcpClassificationError);
  });
```

Update the test `'rejects path-based command launchers'` (around line 177) — relative paths are now bundled binary:

```ts
  it('classifies relative path commands as bundled binary', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'local-path-tool',
      entry: {
        command: './dist/index.js',
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'binary',
      path: path.join(cwd, 'dist'),
      command: './dist/index.js',
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/portable-mcp-classifier.test.ts`
Expected: FAIL because classifier still uses `LOCAL_SCRIPT_RUNNERS` and doesn't return `runtime`.

- [ ] **Step 4: Rewrite the classifier implementation**

Replace the contents of `src/services/portable-mcp-classifier.ts`:

```ts
import path from 'node:path';

import { ValidationError } from '../errors.js';
import type {
  LocalBundledMcpServerConfig,
  LocalNpmMcpServerConfig,
  McpRuntime,
  RemoteMcpServerConfig,
} from '../types.js';
import type { AgentMcpEntry, PortableRemoteMcpMetadata } from './agent-config-service.js';
import { detectMcpRuntime, extractEntrypoint } from './runtime-detector.js';

const NPX_LIKE_COMMANDS = new Set(['npx', 'uvx']);

export type PortableMcpClassification =
  | LocalNpmMcpServerConfig
  | LocalBundledMcpServerConfig
  | RemoteMcpServerConfig;

export class PortableMcpClassificationError extends ValidationError {}

export function classifyPortableMcp(options: {
  cwd: string;
  key: string;
  entry: AgentMcpEntry;
  remote?: PortableRemoteMcpMetadata;
}): PortableMcpClassification {
  if (options.remote) {
    return classifyRemoteMcp(options.key, options.remote);
  }

  const packageName = resolveNpxPackage(options.entry);
  if (packageName) {
    return {
      kind: 'local',
      source: 'npm',
      package: packageName,
      ...(options.entry.env ? { env: options.entry.env } : {}),
    };
  }

  const runtime = detectMcpRuntime(options.entry.command);
  if (runtime) {
    return classifyBundledMcp(options.cwd, options.key, options.entry, runtime);
  }

  throw new PortableMcpClassificationError(
    `MCP "${options.key}" cannot be packed: unrecognized command "${options.entry.command}".`
  );
}

function classifyBundledMcp(
  cwd: string,
  key: string,
  entry: AgentMcpEntry,
  runtime: McpRuntime
): LocalBundledMcpServerConfig {
  const entrypoint = extractEntrypoint(entry.command, entry.args ?? []);

  let bundlePath: string;
  if (runtime === 'rust') {
    bundlePath = cwd;
  } else if (entrypoint) {
    const resolvedEntrypoint = path.resolve(cwd, entrypoint);
    const entrypointDir = path.dirname(resolvedEntrypoint);
    bundlePath = resolveProjectLocalPath(cwd, entrypointDir, key);
  } else {
    throw new PortableMcpClassificationError(
      `MCP "${key}" cannot be packed: could not determine entrypoint from args.`
    );
  }

  return {
    kind: 'local',
    source: 'bundled',
    runtime,
    path: bundlePath,
    command: entry.command,
    ...(entry.args ? { args: entry.args } : {}),
    ...(entry.env ? { env: entry.env } : {}),
  };
}

function classifyRemoteMcp(
  key: string,
  remote: PortableRemoteMcpMetadata
): RemoteMcpServerConfig {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(remote.url);
  } catch {
    throw new PortableMcpClassificationError(
      `Remote MCP "${key}" must include an absolute http(s) url.`
    );
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new PortableMcpClassificationError(
      `Remote MCP "${key}" must include an absolute http(s) url.`
    );
  }

  if (remote.transport !== 'http' && remote.transport !== 'sse') {
    throw new PortableMcpClassificationError(
      `Remote MCP "${key}" must use transport "http" or "sse".`
    );
  }

  return {
    kind: 'remote',
    transport: remote.transport,
    url: remote.url,
    ...(remote.headers ? { headers: remote.headers } : {}),
    ...(remote.env ? { env: remote.env } : {}),
  };
}

function resolveNpxPackage(entry: AgentMcpEntry): string | null {
  if (!NPX_LIKE_COMMANDS.has(entry.command)) {
    return null;
  }

  const packageName = resolveDeclaredNpxPackage(entry.args ?? []);
  if (!packageName) {
    throw new PortableMcpClassificationError(
      'npx/uvx-based MCP entries must include a package or executable argument.'
    );
  }

  return packageName;
}

function resolveDeclaredNpxPackage(args: string[]): string | null {
  let packageName: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--package') {
      const nextArg = args[index + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        return nextArg;
      }
      continue;
    }

    if (arg.startsWith('--package=')) {
      const declaredPackage = arg.slice('--package='.length).trim();
      if (declaredPackage.length > 0) {
        return declaredPackage;
      }
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    if (!packageName) {
      packageName = arg;
    }
  }

  return packageName;
}

function resolveProjectLocalPath(cwd: string, candidate: string, key: string): string {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new PortableMcpClassificationError(
      `MCP "${key}" cannot be packed: path "${candidate}" is outside the project directory.`
    );
  }

  return resolved;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/portable-mcp-classifier.test.ts`
Expected: PASS for all tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/portable-mcp-classifier.ts tests/portable-mcp-classifier.test.ts
git commit -m "feat: extend classifier with multi-runtime detection and uvx support"
```

---

### Task 4: Update pack service to use runtime-aware exclude filtering and write runtime/install/exclude into profile.yaml

**Files:**
- Modify: `src/services/portable-profile-pack-service.ts`
- Modify: `tests/portable-profile-pack-service.test.ts`

- [ ] **Step 1: Add new tests for runtime-aware packing**

Append to the existing `describe` block in `tests/portable-profile-pack-service.test.ts`:

```ts
  it('writes runtime, install, and exclude into profile.yaml for bundled MCPs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pack-rt-'));
    tempDirs.push(root);

    const cwd = path.join(root, 'workspace');
    const pyDir = path.join(cwd, 'py-server');
    await mkdir(pyDir, { recursive: true });
    await writeFile(path.join(pyDir, 'server.py'), 'print("hi")', 'utf8');
    await writeFile(path.join(pyDir, 'requirements.txt'), 'fastmcp', 'utf8');

    const service = createPortableProfilePackService({
      profileService: {
        async get() {
          return {
            name: 'multi-rt',
            skills: {},
            mcps: {
              'py-tool': {
                kind: 'local' as const,
                source: 'bundled' as const,
                runtime: 'python' as const,
                path: './py-server',
                command: 'python',
                args: ['server.py'],
                install: 'pip install -r requirements.txt',
                exclude: ['.venv', '__pycache__', '*.pyc'],
              },
            },
            memory: { paths: [] },
          };
        },
      },
    });

    const archivePath = path.join(cwd, 'multi-rt.tar.gz');
    await service.execute({
      cwd,
      source: { source: 'profile', name: 'multi-rt' },
      outputPath: archivePath,
    });

    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pack-rt-extract-'));
    tempDirs.push(extractDir);
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`);

    const profile = YAML.parse(await readFile(path.join(extractDir, 'profile.yaml'), 'utf8')) as Record<string, any>;

    expect(profile.mcps['py-tool']).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'python',
      path: './mcps/py-tool',
      command: 'python',
      args: ['server.py'],
      install: 'pip install -r requirements.txt',
      exclude: ['.venv', '__pycache__', '*.pyc'],
    });
  });

  it('excludes runtime-specific directories from bundled archive copy', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pack-excl-'));
    tempDirs.push(root);

    const cwd = path.join(root, 'workspace');
    const pyDir = path.join(cwd, 'py-server');
    await mkdir(path.join(pyDir, '.venv', 'lib'), { recursive: true });
    await mkdir(path.join(pyDir, '__pycache__'), { recursive: true });
    await writeFile(path.join(pyDir, 'server.py'), 'print("hi")', 'utf8');
    await writeFile(path.join(pyDir, '.venv', 'lib', 'pkg.py'), '', 'utf8');
    await writeFile(path.join(pyDir, '__pycache__', 'server.cpython-311.pyc'), '', 'utf8');
    await writeFile(path.join(pyDir, 'requirements.txt'), 'fastmcp', 'utf8');

    const service = createPortableProfilePackService({
      profileService: {
        async get() {
          return {
            name: 'excl-test',
            skills: {},
            mcps: {
              'py-tool': {
                kind: 'local' as const,
                source: 'bundled' as const,
                runtime: 'python' as const,
                path: './py-server',
                command: 'python',
                args: ['server.py'],
                install: 'pip install -r requirements.txt',
                exclude: ['.venv', '__pycache__', '*.pyc'],
              },
            },
            memory: { paths: [] },
          };
        },
      },
    });

    const archivePath = path.join(cwd, 'excl-test.tar.gz');
    await service.execute({
      cwd,
      source: { source: 'profile', name: 'excl-test' },
      outputPath: archivePath,
    });

    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pack-excl-extract-'));
    tempDirs.push(extractDir);
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`);

    const { existsSync } = await import('node:fs');
    expect(existsSync(path.join(extractDir, 'mcps', 'py-tool', 'server.py'))).toBe(true);
    expect(existsSync(path.join(extractDir, 'mcps', 'py-tool', 'requirements.txt'))).toBe(true);
    expect(existsSync(path.join(extractDir, 'mcps', 'py-tool', '.venv'))).toBe(false);
    expect(existsSync(path.join(extractDir, 'mcps', 'py-tool', '__pycache__'))).toBe(false);
  });

  it('auto-detects runtime metadata when packing from live agent config', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-agent-rt-'));
    tempDirs.push(root);

    const cwd = path.join(root, 'workspace');
    await mkdir(cwd, { recursive: true });

    const service = createPortableProfilePackService({
      agentConfigService: {
        async readAll() {
          return [
            {
              agent: 'claude' as const,
              configPath: '/tmp/.claude.json',
              exists: true,
              mcpServers: {
                'py-mcp': {
                  command: 'python',
                  args: ['./src/server.py'],
                },
              },
              remoteMcpServers: {},
              skills: [],
            },
          ];
        },
      },
    });

    const archivePath = path.join(cwd, 'workspace-claude.tar.gz');
    await service.execute({
      cwd,
      source: { source: 'agent', agent: 'claude', cwd },
      outputPath: archivePath,
    });

    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-agent-rt-extract-'));
    tempDirs.push(extractDir);
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`);

    const profile = YAML.parse(await readFile(path.join(extractDir, 'profile.yaml'), 'utf8')) as Record<string, any>;

    expect(profile.mcps['py-mcp'].runtime).toBe('python');
    expect(profile.mcps['py-mcp'].kind).toBe('local');
    expect(profile.mcps['py-mcp'].source).toBe('bundled');
  });
```

- [ ] **Step 2: Update the existing pack test for runtime field**

In `tests/portable-profile-pack-service.test.ts`, update the mock profile in the first test (around line 46-49) to include `runtime: 'node'` in the bundled MCP:

```ts
              bundle: {
                kind: 'local',
                source: 'bundled',
                runtime: 'node',
                path: './mcp-server',
                command: 'node',
              },
```

- [ ] **Step 3: Run tests to verify new ones fail**

Run: `npx vitest run tests/portable-profile-pack-service.test.ts`
Expected: FAIL for new tests because pack service doesn't write `runtime`/`install`/`exclude` or use exclude-based filtering.

- [ ] **Step 4: Update the pack service implementation**

In `src/services/portable-profile-pack-service.ts`:

1. Add imports at the top:

```ts
import { findProjectRoot, getDefaultInstall, getDefaultExclude } from './runtime-detector.js';
```

2. Replace the hardcoded `node_modules` filter in the bundled copy loop (around line 63-65). Change:

```ts
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !src.includes('node_modules'),
          });
```

To:

```ts
          const excludePatterns = getExcludePatternsForMcp(profile.mcps[key]);
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !matchesExcludePattern(src, excludePatterns),
          });
```

3. In `redactAndNormalizeProfile`, when writing bundled MCP entries (around line 159-170), preserve `runtime`, `install`, and `exclude`:

```ts
        return [
          key,
          {
            ...result.redacted,
            path: `./mcps/${key}`,
          },
        ];
```

This already spreads `result.redacted` which will include `runtime`, `install`, and `exclude` if present on the input config.

4. In `buildPackedProfile` for agent-sourced packs (around line 113-123), after `classifyPortableMcp`, enrich bundled results with defaults from runtime detection:

```ts
      const classified = classifyPortableMcp({
        cwd: options.cwd,
        key,
        entry: agentConfig.mcpServers[key] ?? { command: '' },
        remote: agentConfig.remoteMcpServers[key],
      });

      if (classified.kind === 'local' && classified.source === 'bundled') {
        const entrypoint = agentConfig.mcpServers[key]?.args?.[0];
        const entrypointPath = entrypoint ? path.resolve(options.cwd, entrypoint) : classified.path;
        const { marker } = findProjectRoot(entrypointPath, classified.runtime);
        if (!classified.install) {
          classified.install = getDefaultInstall(classified.runtime, marker, classified.path, entrypoint);
        }
        if (!classified.exclude) {
          classified.exclude = getDefaultExclude(classified.runtime, marker);
        }
      }

      return [key, classified];
```

5. Add helper functions at the bottom of the file:

```ts
function getExcludePatternsForMcp(mcp: McpServerConfig): string[] {
  if (mcp.kind === 'local' && mcp.source === 'bundled' && mcp.exclude) {
    return mcp.exclude;
  }
  return ['node_modules'];
}

function matchesExcludePattern(filePath: string, patterns: string[]): boolean {
  const basename = path.basename(filePath);
  for (const pattern of patterns) {
    if (pattern.startsWith('*')) {
      if (basename.endsWith(pattern.slice(1))) return true;
    } else if (basename === pattern) {
      return true;
    }
  }
  return false;
}
```

6. Add `McpServerConfig` to the type imports if not already present.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/portable-profile-pack-service.test.ts`
Expected: PASS for all tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/portable-profile-pack-service.ts tests/portable-profile-pack-service.test.ts
git commit -m "feat: runtime-aware exclude filtering and metadata in packed profiles"
```

---

### Task 5: Update import service to respect runtime-aware install field

**Files:**
- Modify: `src/services/profile-import-service.ts:118`
- Modify: `tests/portable-profile-unpack-service.test.ts`

- [ ] **Step 1: Add a test for skipping install when install is undefined**

In `tests/portable-profile-unpack-service.test.ts`, add a test that imports a profile with a bundled binary MCP that has no `install` field:

```ts
  it('skips install step for bundled MCPs without an install command', async () => {
    // Setup: create a temp archive with a binary MCP (no install field)
    // The import should succeed without trying to run any install command
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-import-noinstall-'));
    tempDirs.push(root);

    const cwd = path.join(root, 'workspace');
    await mkdir(path.join(cwd, '.brainctl', 'profiles'), { recursive: true });

    const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-staging-'));
    tempDirs.push(stagingDir);

    const manifest = {
      schemaVersion: 1,
      profileName: 'bin-test',
    };
    const profile = {
      name: 'bin-test',
      skills: {},
      mcps: {
        'my-binary': {
          kind: 'local',
          source: 'bundled',
          runtime: 'binary',
          path: './mcps/my-binary',
          command: './server',
        },
      },
      memory: { paths: [] },
    };

    await writeFile(path.join(stagingDir, 'manifest.yaml'), YAML.stringify(manifest), 'utf8');
    await writeFile(path.join(stagingDir, 'profile.yaml'), YAML.stringify(profile), 'utf8');
    await mkdir(path.join(stagingDir, 'mcps', 'my-binary'), { recursive: true });
    await writeFile(path.join(stagingDir, 'mcps', 'my-binary', 'server'), '#!/bin/sh\necho ok', 'utf8');

    const archivePath = path.join(root, 'bin-test.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${stagingDir}" .`);

    const service = createProfileImportService({ mcpPreflightService: noopPreflight });

    const result = await service.execute({ cwd, archivePath });

    expect(result.profileName).toBe('bin-test');
    expect(result.installedMcps).toContain('my-binary');
  });
```

Note: `noopPreflight` and other test helpers should already exist or be added inline — a mock that returns `{ checks: [] }` for any input.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/portable-profile-unpack-service.test.ts`
Expected: FAIL because the import service runs `npm install` as fallback, which fails for a binary.

- [ ] **Step 3: Update the import service**

In `src/services/profile-import-service.ts`, replace line 118:

```ts
          const installCmd = mcp.install ?? 'npm install';
```

With:

```ts
          const installCmd = mcp.install;
          if (!installCmd) {
            profile.mcps[name] = {
              ...mcp,
              path: destMcpPath,
            };
            installedMcps.push(name);
            continue;
          }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/portable-profile-unpack-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/profile-import-service.ts tests/portable-profile-unpack-service.test.ts
git commit -m "fix: skip install step for bundled MCPs without install command"
```

---

### Task 6: Full verification

**Files:**
- None expected unless failures expose gaps

- [ ] **Step 1: Run all pack/unpack related tests**

Run: `npx vitest run tests/runtime-detector.test.ts tests/portable-mcp-classifier.test.ts tests/portable-profile-pack-service.test.ts tests/portable-profile-unpack-service.test.ts tests/portable-profile-schema.test.ts`
Expected: All PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Server and web build PASS with no type errors.
