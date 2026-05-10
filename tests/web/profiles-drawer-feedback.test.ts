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

import { toast } from '../../web/src/components/ui/toast.js';
import ProfilesDrawer from '../../web/src/profiles/ProfilesDrawer.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function okJson<T>(body: T) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
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

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ProfilesDrawer feedback', () => {
  it('shows a deleted-profile toast after deleting a profile', async () => {
    let profilesDeleted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/profiles') {
          return okJson({
            profiles: profilesDeleted ? [] : [{ name: 'team' }],
          });
        }
        if (url === '/api/profiles/team' && init?.method === 'DELETE') {
          profilesDeleted = true;
          return okJson({ ok: true });
        }
        throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? 'GET'}`);
      })
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(createElement(ProfilesDrawer));
    });

    await waitFor(() => document.body.textContent?.includes('team') === true);

    const deleteButton = Array.from(document.body.querySelectorAll('li button')).at(-1);
    expect(deleteButton).toBeDefined();

    await act(async () => {
      deleteButton?.click();
    });

    await waitFor(() => document.body.textContent?.includes('Delete profile "team"?') === true);

    const confirmButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete'
    );
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.click();
    });

    expect(toast.success).toHaveBeenCalledWith('Deleted profile "team"');

    await act(async () => {
      root.unmount();
    });
  });
});
