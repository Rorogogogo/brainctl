import { describe, expect, it } from 'vitest';
import { buildPickerSections } from '../../web/src/profiles/board/ProjectBar.js';

describe('buildPickerSections', () => {
  it('splits sources into recents, claude, and dedupes against current and recents', () => {
    const result = buildPickerSections({
      current: '/proj/current',
      claudeProjects: ['/proj/a', '/proj/current', '/proj/b'],
      recents: ['/proj/r1', '/proj/a'],
    });
    expect(result.recents).toEqual(['/proj/r1', '/proj/a']);
    expect(result.claudeOnly).toEqual(['/proj/b']);
  });

  it('handles empty inputs', () => {
    expect(buildPickerSections({ current: '/x', claudeProjects: [], recents: [] }))
      .toEqual({ recents: [], claudeOnly: [] });
  });
});
