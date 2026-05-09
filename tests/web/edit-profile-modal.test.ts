// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EditProfileModal from '../../web/src/profiles/EditProfileModal.js';

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

describe('EditProfileModal', () => {
  it('shows delete-all actions for populated edit sections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/profiles/team/contents') {
          return okJson({
            profile: {
              name: 'team',
              mcps: { docs: {} },
            },
            manifest: {
              plugins: [{ agent: 'codex', name: 'demo' }],
              userSkills: [{ agent: 'codex', name: 'notes' }],
            },
          });
        }
        throw new Error(`Unexpected fetch call: ${String(input)}`);
      })
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(EditProfileModal, {
          open: true,
          onOpenChange: () => {},
          profileName: 'team',
          onChanged: () => {},
        })
      );
    });

    await waitFor(() => document.body.textContent?.includes('Skills (1)') === true);

    expect(
      Array.from(document.body.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Delete all'
      )
    ).toHaveLength(3);

    await act(async () => {
      root.unmount();
    });
  });
});
