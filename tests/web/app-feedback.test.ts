// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../web/src/components/ui/toast.js', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

import App from '../../web/src/App.js';
import { toast } from '../../web/src/components/ui/toast.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function okJson<T>(body: T) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('App feedback', () => {
  it('shows a success toast when a header snapshot creates a profile', async () => {
    vi.stubGlobal('__APP_VERSION__', 'test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/profiles') {
          return okJson({ profiles: [] });
        }
        if (url === '/api/projects') {
          return okJson({ current: '', claudeProjects: [], recents: [] });
        }
        if (url === '/api/agents/live') {
          return okJson([]);
        }
        if (url === '/api/profiles/snapshot' && init?.method === 'POST') {
          return okJson({ profileName: 'snapshot-claude' });
        }
        throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? 'GET'}`);
      })
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(createElement(App));
    });

    const button = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
      candidate.title.includes('Capture current claude state')
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
    });

    expect(toast.success).toHaveBeenCalledWith('Created profile "snapshot-claude" from Claude');

    await act(async () => {
      root.unmount();
    });
  });
});
