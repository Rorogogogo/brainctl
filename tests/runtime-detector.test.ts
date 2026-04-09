import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectMcpRuntime,
  extractEntrypoint,
  findProjectRoot,
  getDefaultExclude,
  getDefaultInstall,
} from '../src/services/runtime-detector.js';

describe('detectMcpRuntime', () => {
  it('maps node to node runtime', () => {
    expect(detectMcpRuntime('node')).toBe('node');
  });

  it('maps nodejs to node runtime', () => {
    expect(detectMcpRuntime('nodejs')).toBe('node');
  });

  it('maps python to python runtime', () => {
    expect(detectMcpRuntime('python')).toBe('python');
  });

  it('maps python3 to python runtime', () => {
    expect(detectMcpRuntime('python3')).toBe('python');
  });

  it('maps java to java runtime', () => {
    expect(detectMcpRuntime('java')).toBe('java');
  });

  it('maps go to go runtime', () => {
    expect(detectMcpRuntime('go')).toBe('go');
  });

  it('maps cargo to rust runtime', () => {
    expect(detectMcpRuntime('cargo')).toBe('rust');
  });

  it('maps relative binary path to binary runtime', () => {
    expect(detectMcpRuntime('./server')).toBe('binary');
  });

  it('maps absolute binary path to binary runtime', () => {
    expect(detectMcpRuntime('/usr/local/bin/mcp')).toBe('binary');
  });

  it('returns null for npx', () => {
    expect(detectMcpRuntime('npx')).toBeNull();
  });

  it('returns null for uvx', () => {
    expect(detectMcpRuntime('uvx')).toBeNull();
  });

  it('returns null for docker', () => {
    expect(detectMcpRuntime('docker')).toBeNull();
  });
});

describe('extractEntrypoint', () => {
  it('returns first non-flag arg for node', () => {
    expect(extractEntrypoint('node', ['--experimental-vm-modules', 'server.js'])).toBe('server.js');
  });

  it('returns first non-flag arg for python', () => {
    expect(extractEntrypoint('python', ['-u', 'main.py'])).toBe('main.py');
  });

  it('returns first non-flag arg for python3', () => {
    expect(extractEntrypoint('python3', ['app.py', '--port', '3000'])).toBe('app.py');
  });

  it('returns null for node with no non-flag args', () => {
    expect(extractEntrypoint('node', ['--experimental-vm-modules'])).toBeNull();
  });

  it('returns arg after -jar for java', () => {
    expect(extractEntrypoint('java', ['-jar', 'server.jar'])).toBe('server.jar');
  });

  it('returns null for java with no -jar', () => {
    expect(extractEntrypoint('java', ['-Xmx512m', 'com.example.Main'])).toBeNull();
  });

  it('returns null for java with -jar at end', () => {
    expect(extractEntrypoint('java', ['-jar'])).toBeNull();
  });

  it('returns arg after run for go', () => {
    expect(extractEntrypoint('go', ['run', 'main.go'])).toBe('main.go');
  });

  it('returns null for go with no run subcommand', () => {
    expect(extractEntrypoint('go', ['build', './...'])).toBeNull();
  });

  it('returns null for go with run at end', () => {
    expect(extractEntrypoint('go', ['run'])).toBeNull();
  });

  it('returns null for cargo', () => {
    expect(extractEntrypoint('cargo', ['run', '--release'])).toBeNull();
  });

  it('returns command itself for relative binary', () => {
    expect(extractEntrypoint('./server', [])).toBe('./server');
  });

  it('returns command itself for absolute binary', () => {
    expect(extractEntrypoint('/usr/local/bin/mcp', [])).toBe('/usr/local/bin/mcp');
  });

  it('returns null for node with empty args', () => {
    expect(extractEntrypoint('node', [])).toBeNull();
  });
});

describe('findProjectRoot', () => {
  it('finds package.json for node runtime', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    const subdir = path.join(tmp, 'src', 'server');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(path.join(tmp, 'package.json'), '{}');
    const entrypoint = path.join(subdir, 'index.js');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'node');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('package.json');
  });

  it('finds pyproject.toml for python runtime', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    const subdir = path.join(tmp, 'src');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(path.join(tmp, 'pyproject.toml'), '[project]');
    const entrypoint = path.join(subdir, 'main.py');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'python');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('pyproject.toml');
  });

  it('finds requirements.txt for python runtime', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    writeFileSync(path.join(tmp, 'requirements.txt'), 'flask');
    const entrypoint = path.join(tmp, 'app.py');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'python');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('requirements.txt');
  });

  it('finds pom.xml for java runtime', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    const subdir = path.join(tmp, 'target');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(path.join(tmp, 'pom.xml'), '<project/>');
    const entrypoint = path.join(subdir, 'app.jar');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'java');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('pom.xml');
  });

  it('prefers pom.xml over build.gradle for java runtime when both exist', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    writeFileSync(path.join(tmp, 'pom.xml'), '<project/>');
    writeFileSync(path.join(tmp, 'build.gradle'), '');
    const entrypoint = path.join(tmp, 'App.java');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'java');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('pom.xml'); // pom.xml checked first
  });

  it('finds build.gradle when no pom.xml', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    writeFileSync(path.join(tmp, 'build.gradle'), '');
    const entrypoint = path.join(tmp, 'App.java');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'java');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('build.gradle');
  });

  it('finds go.mod for go runtime', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    writeFileSync(path.join(tmp, 'go.mod'), 'module example.com/app\n\ngo 1.21');
    const entrypoint = path.join(tmp, 'main.go');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'go');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('go.mod');
  });

  it('finds Cargo.toml for rust runtime', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    writeFileSync(path.join(tmp, 'Cargo.toml'), '[package]');
    const entrypoint = path.join(tmp, 'src', 'main.rs');
    mkdirSync(path.join(tmp, 'src'), { recursive: true });
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'rust');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBe('Cargo.toml');
  });

  it('returns entrypoint directory for binary runtime', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    const entrypoint = path.join(tmp, 'myserver');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'binary');
    expect(result.root).toBe(tmp);
    expect(result.marker).toBeNull();
  });

  it('returns entrypoint directory with null marker when no marker found', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    const subdir = path.join(tmp, 'deeply', 'nested', 'path');
    mkdirSync(subdir, { recursive: true });
    const entrypoint = path.join(subdir, 'server.js');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'node');
    expect(result.marker).toBeNull();
    expect(result.root).toBe(subdir);
  });

  it('walks up max 5 levels', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    // Create 6 levels deep — package.json at tmp root should NOT be found (too deep)
    const deepPath = path.join(tmp, 'a', 'b', 'c', 'd', 'e', 'f');
    mkdirSync(deepPath, { recursive: true });
    writeFileSync(path.join(tmp, 'package.json'), '{}');
    const entrypoint = path.join(deepPath, 'index.js');
    writeFileSync(entrypoint, '');

    const result = findProjectRoot(entrypoint, 'node');
    // 6 levels up would be needed, so marker should not be found
    expect(result.marker).toBeNull();
  });
});

describe('getDefaultInstall', () => {
  it('returns npm install for node', () => {
    expect(getDefaultInstall('node', 'package.json', '/tmp/project')).toBe('npm install');
  });

  it('returns pip install -r requirements.txt for python with requirements.txt', () => {
    expect(getDefaultInstall('python', 'requirements.txt', '/tmp/project')).toBe(
      'pip install -r requirements.txt'
    );
  });

  it('returns uv sync for python with pyproject.toml and uv.lock', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    writeFileSync(path.join(tmp, 'pyproject.toml'), '[project]');
    writeFileSync(path.join(tmp, 'uv.lock'), '');

    expect(getDefaultInstall('python', 'pyproject.toml', tmp)).toBe('uv sync');
  });

  it('returns pip install -e . for python with pyproject.toml and no uv.lock', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'brainctl-test-'));
    writeFileSync(path.join(tmp, 'pyproject.toml'), '[project]');

    expect(getDefaultInstall('python', 'pyproject.toml', tmp)).toBe('pip install -e .');
  });

  it('returns undefined for java with .jar entrypoint', () => {
    expect(getDefaultInstall('java', 'pom.xml', '/tmp/project', 'server.jar')).toBeUndefined();
  });

  it('returns mvn package -q for java with pom.xml', () => {
    expect(getDefaultInstall('java', 'pom.xml', '/tmp/project')).toBe('mvn package -q');
  });

  it('returns gradle build for java with build.gradle', () => {
    expect(getDefaultInstall('java', 'build.gradle', '/tmp/project')).toBe('gradle build');
  });

  it('returns undefined for java with no marker', () => {
    expect(getDefaultInstall('java', null, '/tmp/project')).toBeUndefined();
  });

  it('returns go build ./... for go', () => {
    expect(getDefaultInstall('go', 'go.mod', '/tmp/project')).toBe('go build ./...');
  });

  it('returns cargo build --release for rust', () => {
    expect(getDefaultInstall('rust', 'Cargo.toml', '/tmp/project')).toBe('cargo build --release');
  });

  it('returns undefined for binary', () => {
    expect(getDefaultInstall('binary', null, '/tmp/project')).toBeUndefined();
  });
});

describe('getDefaultExclude', () => {
  it('returns node_modules for node', () => {
    expect(getDefaultExclude('node')).toEqual(['node_modules']);
  });

  it('returns python excludes for python', () => {
    expect(getDefaultExclude('python')).toEqual(['.venv', '__pycache__', '*.pyc']);
  });

  it('returns target for rust', () => {
    expect(getDefaultExclude('rust')).toEqual(['target']);
  });

  it('returns target for java with pom.xml', () => {
    expect(getDefaultExclude('java', 'pom.xml')).toEqual(['target']);
  });

  it('returns build for java with build.gradle', () => {
    expect(getDefaultExclude('java', 'build.gradle')).toEqual(['build']);
  });

  it('returns undefined for java with no marker', () => {
    expect(getDefaultExclude('java')).toBeUndefined();
  });

  it('returns undefined for go', () => {
    expect(getDefaultExclude('go')).toBeUndefined();
  });

  it('returns undefined for binary', () => {
    expect(getDefaultExclude('binary')).toBeUndefined();
  });
});
