import { describe, expect, it } from 'vitest';

import { createSkillPreflightService } from '../src/services/skill-preflight-service.js';

describe('skill preflight service', () => {
  it('rejects marketplace plugin entries because they are not local skill folders', async () => {
    const service = createSkillPreflightService({
      pathExists: async () => true,
    });

    const result = await service.execute({
      sourceAgent: 'claude',
      targetAgent: 'codex',
      skillName: 'github',
      source: 'claude-plugins-official',
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      label: 'Source',
      status: 'error',
      message:
        'Only local skill folders can be copied today. "github" is a plugin/managed entry from claude-plugins-official.',
    });
  });

  it('rejects local skill copies when the source skill folder is missing', async () => {
    const service = createSkillPreflightService({
      pathExists: async () => false,
    });

    const result = await service.execute({
      sourceAgent: 'codex',
      targetAgent: 'gemini',
      skillName: 'notes',
      source: 'local',
    });

    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({
      label: 'Source',
      status: 'error',
    });
  });

  it('passes for a local skill folder that exists on disk', async () => {
    const service = createSkillPreflightService({
      pathExists: async () => true,
    });

    const result = await service.execute({
      sourceAgent: 'codex',
      targetAgent: 'gemini',
      skillName: 'notes',
      source: 'local',
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual({
      label: 'Source',
      status: 'ok',
      message: expect.stringContaining('Skill folder was found:'),
    });
  });
});
