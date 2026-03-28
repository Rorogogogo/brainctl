import { describe, expect, it } from 'vitest';

import {
  buildRunStreamUrl,
  createRunDefaults,
  getRunAgentOptions
} from '../web/src/run-view.js';

describe('run view helpers', () => {
  it('defaults to the first available agent while preserving unavailable choices', () => {
    const workspace = {
      skills: ['summarize', 'analyze'],
      agents: {
        claude: {
          agent: 'claude',
          available: false,
          command: 'claude'
        },
        codex: {
          agent: 'codex',
          available: true,
          command: 'codex'
        }
      }
    };

    expect(createRunDefaults(workspace)).toEqual({
      skill: 'summarize',
      inputFile: './input.md',
      primaryAgent: 'codex',
      fallbackAgent: ''
    });

    expect(getRunAgentOptions(workspace)).toEqual([
      {
        agent: 'claude',
        available: false,
        command: 'claude'
      },
      {
        agent: 'codex',
        available: true,
        command: 'codex'
      }
    ]);
  });

  it('builds the SSE stream URL with an optional fallback agent', () => {
    expect(
      buildRunStreamUrl({
        skill: 'summarize',
        inputFile: './input.md',
        primaryAgent: 'codex'
      })
    ).toBe('/api/run/stream?skill=summarize&inputFile=.%2Finput.md&primaryAgent=codex');

    expect(
      buildRunStreamUrl({
        skill: 'summarize',
        inputFile: './input.md',
        primaryAgent: 'claude',
        fallbackAgent: 'codex'
      })
    ).toBe(
      '/api/run/stream?skill=summarize&inputFile=.%2Finput.md&primaryAgent=claude&fallbackAgent=codex'
    );
  });
});
