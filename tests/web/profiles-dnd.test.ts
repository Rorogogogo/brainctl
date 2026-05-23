import { describe, expect, it } from 'vitest';

import {
  parseDragId,
  parseDropId,
  resolveCrossAgentDropId,
} from '../../web/src/profiles/board/dnd.js';

describe('profiles board dnd helpers', () => {
  it('parses drag ids', () => {
    expect(parseDragId('claude:skill:notes')).toEqual({
      agent: 'claude',
      category: 'skill',
      key: 'notes',
    });
  });

  it('maps a cross-agent skill drop to the skills anchor', () => {
    expect(resolveCrossAgentDropId('claude:skill:notes', 'codex:column')).toBe('codex:skills:anchor');
  });

  it('parses anchor drops', () => {
    expect(parseDropId('antigravity:plugins:anchor')).toEqual({
      agent: 'antigravity',
      category: 'plugin',
    });
  });
});
