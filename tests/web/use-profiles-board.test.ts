// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';

import {
  useProfilesBoard,
  type OverlayData,
} from '../../web/src/profiles/board/useProfilesBoard.js';
import type { AgentLiveConfig, PendingChange } from '../../web/src/profiles-view.js';

type BoardState = ReturnType<typeof useProfilesBoard>;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function okJson<T>(body: T) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

function errorJson(message: string, status = 500) {
  return {
    ok: false,
    status,
    statusText: message,
    json: async () => ({ error: message }),
  };
}

function HookProbe({ onRender }: { onRender: (state: BoardState) => void }) {
  const state = useProfilesBoard();

  useEffect(() => {
    onRender(state);
  }, [onRender, state]);

  return null;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error('Timed out waiting for condition.');
}

async function renderBoardHook() {
  let latest: BoardState | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(HookProbe, {
        onRender: (state: BoardState) => {
          latest = state;
        },
      })
    );
  });

  await waitFor(() => latest !== null && latest.loading === false);

  return {
    getLatest(): BoardState {
      if (!latest) {
        throw new Error('Hook state was not captured.');
      }
      return latest;
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const BASE_CONFIGS: AgentLiveConfig[] = [
  {
    agent: 'claude',
    configPath: '/tmp/claude.json',
    exists: true,
    mcpServers: {},
    remoteMcpServers: {},
    skills: [{ name: 'notes', source: 'local', kind: 'skill' }],
  },
  {
    agent: 'codex',
    configPath: '/tmp/codex.toml',
    exists: true,
    mcpServers: {},
    remoteMcpServers: {},
    skills: [],
  },
  {
    agent: 'gemini',
    configPath: '/tmp/gemini.json',
    exists: true,
    mcpServers: {},
    remoteMcpServers: {},
    skills: [],
  },
];

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('useProfilesBoard integration', () => {
  it('preserves staged changes when refresh reload fails', async () => {
    let liveFetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/agents/live') {
          liveFetchCount += 1;
          return liveFetchCount === 1
            ? okJson(BASE_CONFIGS)
            : errorJson('refresh failed');
        }

        throw new Error(`Unexpected fetch call: ${url}`);
      })
    );

    const harness = await renderBoardHook();

    await act(async () => {
      harness.getLatest().handleStagedRemove('claude', 'skill', 'notes');
    });

    expect(harness.getLatest().pendingChanges).toHaveLength(1);

    await act(async () => {
      await harness.getLatest().handleRefresh();
    });

    expect(harness.getLatest().pendingChanges).toHaveLength(1);
    expect(harness.getLatest().refreshState).toBe('idle');
    expect(toast.error).toHaveBeenCalledWith('Failed to load agent configs: refresh failed');

    await harness.unmount();
  });

  it('keeps the saved board state when apply succeeds but the follow-up reload fails', async () => {
    let liveFetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/agents/live') {
          liveFetchCount += 1;
          return liveFetchCount === 1 ? okJson(BASE_CONFIGS) : errorJson('reload failed');
        }

        if (
          url === '/api/agents/claude/skills/notes' &&
          (init?.method ?? 'GET') === 'DELETE'
        ) {
          return okJson({});
        }

        throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? 'GET'}`);
      })
    );

    const harness = await renderBoardHook();

    await act(async () => {
      harness.getLatest().setIsEditMode(true);
    });

    await act(async () => {
      harness.getLatest().handleStagedRemove('claude', 'skill', 'notes');
    });

    expect(harness.getLatest().pendingChanges).toHaveLength(1);

    await act(async () => {
      await harness.getLatest().handleConfirmSave();
    });

    await waitFor(() => harness.getLatest().pendingChanges.length === 0);

    expect(harness.getLatest().isEditMode).toBe(false);
    expect(harness.getLatest().previewConfigs[0].skills).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      'Applied 1 change',
      expect.objectContaining({
        description: expect.stringContaining('Live reload failed: reload failed'),
      })
    );

    await harness.unmount();
  });
});
