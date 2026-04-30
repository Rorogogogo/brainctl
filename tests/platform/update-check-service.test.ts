import { describe, expect, it } from 'vitest';

import {
  createUpdateCheckService,
  isNewer,
} from '../../src/services/platform/update-check-service.js';

describe('update check service', () => {
  describe('check', () => {
    it('returns outdated when registry has a newer version', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.current).toBe('0.1.7');
      expect(result.latest).toBe('0.2.0');
      expect(result.isOutdated).toBe(true);
      expect(result.fromCache).toBe(false);
    });

    it('uses cached version when within TTL', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => {
          throw new Error('should not be called');
        },
        readCache: async () => ({
          lastCheck: new Date().toISOString(),
          latestVersion: '0.2.0',
        }),
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(result.latest).toBe('0.2.0');
    });

    it('fetches from registry when cache is expired', async () => {
      const expired = new Date(
        Date.now() - 25 * 60 * 60 * 1000
      ).toISOString();
      let cacheWritten: { lastCheck: string; latestVersion: string } | null =
        null;

      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.3.0',
        readCache: async () => ({
          lastCheck: expired,
          latestVersion: '0.2.0',
        }),
        writeCache: async (cache) => {
          cacheWritten = cache;
        },
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.latest).toBe('0.3.0');
      expect(cacheWritten?.latestVersion).toBe('0.3.0');
    });

    it('returns not outdated when fetch fails and no cache', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => {
          throw new Error('network error');
        },
        readCache: async () => null,
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(false);
      expect(result.current).toBe('0.1.7');
      expect(result.latest).toBe('0.1.7');
    });

    it('returns not outdated when already on latest', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.2.0',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
      });

      const result = await service.check();

      expect(result.isOutdated).toBe(false);
    });
  });

  describe('isNewer', () => {
    it('returns true for newer major', () => {
      expect(isNewer('2.0.0', '1.0.0')).toBe(true);
    });

    it('returns true for newer minor', () => {
      expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    });

    it('returns true for newer patch', () => {
      expect(isNewer('0.1.8', '0.1.7')).toBe(true);
    });

    it('returns false for same version', () => {
      expect(isNewer('0.1.7', '0.1.7')).toBe(false);
    });

    it('returns false for older version', () => {
      expect(isNewer('0.1.6', '0.1.7')).toBe(false);
    });
  });

  describe('selfUpdate', () => {
    it('returns success when npm install succeeds', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
        runInstall: async () => ({ success: true }),
      });

      const result = await service.selfUpdate();

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe('0.1.7');
    });

    it('returns failure with error when npm install fails', async () => {
      const service = createUpdateCheckService({
        currentVersion: '0.1.7',
        fetchLatestVersion: async () => '0.2.0',
        readCache: async () => null,
        writeCache: async () => {},
        runInstall: async () => ({ success: false, error: 'EACCES' }),
      });

      const result = await service.selfUpdate();

      expect(result.success).toBe(false);
      expect(result.error).toBe('EACCES');
    });
  });
});
