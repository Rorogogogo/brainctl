import { readFile } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import type { PortableProfileManifest, ProfileConfig } from '../src/types.js';

async function loadYamlFixture<T>(relativePath: string): Promise<T> {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return YAML.parse(source) as T;
}

describe('portable profile schema', () => {
  it('defines the minimal portable archive contract', async () => {
    const manifest = await loadYamlFixture<PortableProfileManifest>(
      './fixtures/portable-profile/minimal/manifest.yaml'
    );
    const profile = await loadYamlFixture<ProfileConfig>(
      './fixtures/portable-profile/minimal/profile.yaml'
    );

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.profileName).toBe('team-profile');
    expect(manifest.source).toEqual({
      kind: 'profile',
      profileName: 'team-profile',
    });
    expect(profile.name).toBe('team-profile');

    const mcps = profile.mcps;
    expect(mcps.github.kind).toBe('local');
    expect(mcps.github.source).toBe('npm');
    expect(mcps.github.package).toBe('@modelcontextprotocol/server-github');
    expect(mcps.docs.kind).toBe('remote');
    expect(mcps.docs.transport).toBe('http');
    expect(mcps.docs.url).toBe('https://mcp.example.com');
    expect(mcps.docs.headers?.Authorization).toBe(
      'Bearer ${credentials.internal_api_key}'
    );
  });

  it('defines bundled portable archives with explicit paths', async () => {
    const manifest = await loadYamlFixture<PortableProfileManifest>(
      './fixtures/portable-profile/bundled/manifest.yaml'
    );
    const profile = await loadYamlFixture<ProfileConfig>(
      './fixtures/portable-profile/bundled/profile.yaml'
    );

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.profileName).toBe('bundled-profile');
    expect(manifest.source).toEqual({
      kind: 'agent',
      agent: 'claude',
    });

    const mcps = profile.mcps;
    expect(mcps.bundle.kind).toBe('local');
    expect(mcps.bundle.source).toBe('bundled');
    expect(mcps.bundle.path).toBe('./mcps/bundle');
    expect(mcps.bundle.command).toBe('node');
    expect(path.extname(String(mcps.bundle.path))).toBe('');
  });
});
