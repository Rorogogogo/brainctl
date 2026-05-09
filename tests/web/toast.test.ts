// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toast, resetToastsForTest } from '../../web/src/components/ui/toast.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetToastsForTest();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('toast', () => {
  it('mounts custom toast messages without Sonner', async () => {
    await act(async () => {
      toast.success('Profile saved');
    });

    expect(document.body.textContent).toContain('Profile saved');
  });
});
