import { describe, expect, it } from 'vitest';

import { buildContext } from '../src/context/builder.js';

describe('buildContext', () => {
  it('combines memory, skill, and input into the required prompt format', () => {
    const prompt = buildContext({
      memory: '# Notes\nRemember the deadline.',
      skill: 'Summarize the content.',
      input: 'Draft the release summary.'
    });

    expect(prompt).toBe(
      '--- MEMORY ---\n' +
        '# Notes\nRemember the deadline.\n\n' +
        '--- SKILL ---\n' +
        'Summarize the content.\n\n' +
        '--- INPUT ---\n' +
        'Draft the release summary.'
    );
  });
});
