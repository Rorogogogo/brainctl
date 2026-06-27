// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toast, resetToastsForTest } from '../../web/src/components/ui/toast.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function waitForElement(selector: string): Promise<Element> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const element = document.querySelector(selector);
    if (element) return element;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

afterEach(() => {
  resetToastsForTest();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('toast', () => {
  it('mounts custom toast messages without Sonner', async () => {
    await act(async () => {
      toast.message({ text: 'Profile saved' });
    });

    expect(document.body.textContent).toContain('Profile saved');
  });

  it('renders normal messages with the white message variant', async () => {
    await act(async () => {
      toast.message({ text: 'Profile saved' });
    });

    const toastEl = await waitForElement('.bg-popover');
    expect(toastEl.textContent).toContain('Profile saved');
    expect(toastEl.className).not.toContain('bg-blue-700');
  });

  it('renders success messages with the green success variant', async () => {
    await act(async () => {
      toast.success('Profile saved');
    });

    const toastEl = document.body.textContent?.includes('Profile saved')
      ? document.querySelector('.bg-emerald-600')
      : null;
    expect(toastEl).not.toBeNull();
  });

  it('mounts the toast stack in the top-right corner', async () => {
    await act(async () => {
      toast.message({ text: 'Profile saved' });
    });

    const topRightStack = Array.from(document.querySelectorAll('div')).find((el) =>
      ['top-4', 'right-4', 'z-[9999]'].every((className) => el.classList.contains(className))
    );
    expect(topRightStack).toBeDefined();
  });
});
