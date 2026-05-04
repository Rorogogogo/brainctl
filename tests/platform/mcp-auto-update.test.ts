import { describe, expect, it, vi } from 'vitest';

import { autoUpdateAndRelaunch } from '../../src/commands/mcp.js';
import type { UpdateCheckService } from '../../src/services/platform/update-check-service.js';

function makeService(overrides: Partial<UpdateCheckService> = {}): UpdateCheckService {
  return {
    check: async () => ({
      current: '0.1.19',
      latest: '0.1.22',
      isOutdated: true,
      fromCache: false,
    }),
    selfUpdate: async () => ({
      success: true,
      fromVersion: '0.1.19',
      toVersion: 'latest',
    }),
    ...overrides,
  };
}

describe('autoUpdateAndRelaunch', () => {
  it('skips when BRAINCTL_NO_UPDATE_CHECK is set', async () => {
    const service = makeService();
    const checkSpy = vi.spyOn(service, 'check');
    const result = await autoUpdateAndRelaunch({
      service,
      env: { BRAINCTL_NO_UPDATE_CHECK: '1' },
    });
    expect(result).toEqual({ updated: false, reason: 'disabled' });
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('skips when BRAINCTL_NO_AUTO_UPDATE is set', async () => {
    const result = await autoUpdateAndRelaunch({
      service: makeService(),
      env: { BRAINCTL_NO_AUTO_UPDATE: '1' },
    });
    expect(result).toEqual({ updated: false, reason: 'disabled' });
  });

  it('skips when already re-launched (loop guard)', async () => {
    const result = await autoUpdateAndRelaunch({
      service: makeService(),
      env: { BRAINCTL_SELF_UPDATED: '1' },
    });
    expect(result).toEqual({ updated: false, reason: 'already-updated' });
  });

  it('skips when current version is up to date', async () => {
    const service = makeService({
      check: async () => ({
        current: '0.1.22',
        latest: '0.1.22',
        isOutdated: false,
        fromCache: true,
      }),
    });
    const log = vi.fn();
    const relaunch = vi.fn();
    const result = await autoUpdateAndRelaunch({ service, env: {}, log, relaunch });
    expect(result).toEqual({ updated: false, reason: 'up-to-date' });
    expect(log).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('returns up-to-date when version check throws', async () => {
    const service = makeService({
      check: async () => {
        throw new Error('network down');
      },
    });
    const result = await autoUpdateAndRelaunch({ service, env: {} });
    expect(result.updated).toBe(false);
    expect(result.reason).toBe('up-to-date');
  });

  it('does not re-launch when self-update fails', async () => {
    const service = makeService({
      selfUpdate: async () => ({
        success: false,
        fromVersion: '0.1.19',
        toVersion: '0.1.19',
        error: 'EACCES',
      }),
    });
    const log = vi.fn();
    const relaunch = vi.fn();
    const exit = vi.fn();
    const result = await autoUpdateAndRelaunch({
      service,
      env: {},
      log,
      relaunch,
      exit,
    });
    expect(result).toEqual({ updated: false, reason: 'install-failed' });
    expect(relaunch).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    const messages = log.mock.calls.map((c) => c[0]).join('');
    expect(messages).toContain('self-update failed');
    expect(messages).toContain('EACCES');
  });

  it('relaunches with BRAINCTL_SELF_UPDATED=1 and exits with child status', async () => {
    const service = makeService();
    const log = vi.fn();
    const relaunch = vi.fn().mockReturnValue(0);
    const exit = vi.fn();
    await autoUpdateAndRelaunch({
      service,
      env: { PATH: '/usr/bin' },
      log,
      relaunch,
      exit,
    });
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(relaunch.mock.calls[0][0]).toMatchObject({
      PATH: '/usr/bin',
      BRAINCTL_SELF_UPDATED: '1',
    });
    expect(exit).toHaveBeenCalledWith(0);
    const messages = log.mock.calls.map((c) => c[0]).join('');
    expect(messages).toContain('auto-updating 0.1.19 -> 0.1.22');
  });

  it('propagates non-zero child exit codes', async () => {
    const service = makeService();
    const exit = vi.fn();
    await autoUpdateAndRelaunch({
      service,
      env: {},
      log: () => {},
      relaunch: () => 17,
      exit,
    });
    expect(exit).toHaveBeenCalledWith(17);
  });
});
