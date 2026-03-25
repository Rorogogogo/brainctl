import { describe, expect, it } from 'vitest';

import { createClaudeInvocation } from '../src/executor/claude.js';
import { createCodexInvocation } from '../src/executor/codex.js';

describe('executor invocations', () => {
  it('uses Claude print mode for non-interactive execution', () => {
    const invocation = createClaudeInvocation('hello');

    expect(invocation.command).toBe('claude');
    expect(invocation.args).toEqual(['-p']);
    expect(invocation.context).toBe('hello');
  });

  it('uses Codex exec mode for non-interactive execution', () => {
    const invocation = createCodexInvocation('hello');

    expect(invocation.command).toBe('codex');
    expect(invocation.args).toEqual(['exec', '--skip-git-repo-check', '-']);
    expect(invocation.context).toBe('hello');
  });
});
