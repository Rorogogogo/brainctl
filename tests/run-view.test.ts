import { describe, expect, it } from 'vitest';

import {
  buildRunStreamUrl,
  createRunDefaults,
  connectRunStream,
  getRunAgentOptions,
  getRunFallbackAgentOptions,
  normalizeRunFallbackAgent
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

  it('excludes the selected primary agent from fallback options and clears invalid fallback selections', () => {
    const workspace = {
      skills: ['summarize'],
      agents: {
        claude: {
          agent: 'claude',
          available: true,
          command: 'claude'
        },
        codex: {
          agent: 'codex',
          available: false,
          command: 'codex'
        }
      }
    };

    expect(getRunFallbackAgentOptions(workspace, 'claude')).toEqual([
      {
        agent: 'codex',
        available: false,
        command: 'codex'
      }
    ]);
    expect(getRunFallbackAgentOptions(workspace, 'codex')).toEqual([
      {
        agent: 'claude',
        available: true,
        command: 'claude'
      }
    ]);

    expect(normalizeRunFallbackAgent('claude', 'claude')).toBe('');
    expect(normalizeRunFallbackAgent('codex', 'claude')).toBe('claude');
  });

  it('handles structured run-error events and closes the source', () => {
    const source = new FakeEventSource();
    const output: string[] = [];
    let result: unknown = null;
    let errorMessage: string | null = null;

    connectRunStream({
      createEventSource: () => source,
      url: '/api/run/stream?skill=summarize&inputFile=./input.md&primaryAgent=claude',
      onOutputChunk(chunk) {
        output.push(chunk);
      },
      onResult(trace) {
        result = trace;
      },
      onError(message) {
        errorMessage = message;
      }
    });

    source.emit('output', 'chunk-1');
    source.emit('run-error', JSON.stringify({ error: 'executor exploded' }));

    expect(output).toEqual(['chunk-1']);
    expect(result).toBeNull();
    expect(errorMessage).toBe('executor exploded');
    expect(source.closed).toBe(true);
  });

  it('closes the source after a successful result', () => {
    const source = new FakeEventSource();
    let result: unknown = null;
    let errorMessage: string | null = null;

    connectRunStream({
      createEventSource: () => source,
      url: '/api/run/stream?skill=summarize&inputFile=./input.md&primaryAgent=claude',
      onResult(trace) {
        result = trace;
      },
      onError(message) {
        errorMessage = message;
      },
      onOutputChunk() {}
    });

    source.emit('result', JSON.stringify({ finalExitCode: 0, steps: [], finalOutput: 'done' }));

    expect(result).toEqual({ finalExitCode: 0, steps: [], finalOutput: 'done' });
    expect(errorMessage).toBeNull();
    expect(source.closed).toBe(true);
  });

  it('falls back to a generic transport error when the source errors before completion', () => {
    const source = new FakeEventSource();
    let errorMessage: string | null = null;

    connectRunStream({
      createEventSource: () => source,
      url: '/api/run/stream?skill=summarize&inputFile=./input.md&primaryAgent=claude',
      onError(message) {
        errorMessage = message;
      },
      onResult() {},
      onOutputChunk() {}
    });

    source.triggerError();

    expect(errorMessage).toBe('The run stream ended before a final result was received.');
    expect(source.closed).toBe(true);
  });
});

class FakeEventSource {
  public closed = false;
  private readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
  public onerror: null | (() => void) = null;

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }

  triggerError(): void {
    this.onerror?.();
  }
}
