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
