import { describe, expect, it } from 'vitest';

import { SkillNotFoundError } from '../src/errors.js';
import { resolveSkillPrompt } from '../src/context/skills.js';
import type { BrainctlConfig } from '../src/types.js';

const config: BrainctlConfig = {
  configPath: '/tmp/ai-stack.yaml',
  rootDir: '/tmp',
  memory: {
    paths: ['/tmp/memory']
  },
  skills: {
    summarize: {
      description: 'Summarize content',
      prompt: 'Summarize the content.'
    }
  },
  mcps: {}
};

describe('resolveSkillPrompt', () => {
  it('returns the prompt for an existing skill', () => {
    expect(resolveSkillPrompt(config, 'summarize')).toBe('Summarize the content.');
  });

  it('throws a SkillNotFoundError when the skill does not exist', () => {
    expect(() => resolveSkillPrompt(config, 'analyze')).toThrowError(
      new SkillNotFoundError('Skill "analyze" is not defined in ai-stack.yaml.')
    );
  });
});
