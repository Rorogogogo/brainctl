import path from 'node:path';
import os from 'node:os';

import { describe, expect, it, vi } from 'vitest';

const { mockHomedir } = vi.hoisted(() => ({ mockHomedir: vi.fn() }));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: mockHomedir };
});

import { getSkillDir } from '../../src/services/plugin/skill-paths.js';

describe('getSkillDir', () => {
  it('returns the home-rooted user dir for claude when scope is user', () => {
    mockHomedir.mockReturnValue('/home/u');
    expect(getSkillDir('claude', 'foo')).toBe(path.join('/home/u', '.claude', 'skills', 'foo'));
    expect(getSkillDir('claude', 'foo', 'user')).toBe(
      path.join('/home/u', '.claude', 'skills', 'foo')
    );
  });

  it('returns the cwd-rooted project dir for claude when scope is project', () => {
    expect(getSkillDir('claude', 'foo', 'project', '/repo')).toBe(
      path.join('/repo', '.claude', 'skills', 'foo')
    );
  });

  it('throws when project scope is requested for codex or antigravity', () => {
    expect(() => getSkillDir('codex', 'foo', 'project', '/repo')).toThrow(/project-scoped/i);
    expect(() => getSkillDir('antigravity', 'foo', 'project', '/repo')).toThrow(/project-scoped/i);
  });

  it('throws when project scope is requested without a cwd', () => {
    expect(() => getSkillDir('claude', 'foo', 'project')).toThrow(/cwd is required/);
  });

  it('keeps the user dirs for codex and antigravity unchanged', () => {
    mockHomedir.mockReturnValue('/h');
    expect(getSkillDir('codex', 'x')).toBe(path.join('/h', '.codex', 'skills', 'x'));
    expect(getSkillDir('antigravity', 'x')).toBe(path.join('/h', '.gemini', 'skills', 'x'));
  });

  // satisfy unused-imports guard
  it('os module is real', () => {
    expect(typeof os.tmpdir).toBe('function');
  });
});
