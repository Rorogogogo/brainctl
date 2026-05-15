import type { Command } from 'commander';

import {
  createBrainctlConfigService,
  resolveBrainctlApiTarget,
  type BrainctlConfigKey,
} from '../services/platform/brainctl-config-service.js';

const SUPPORTED_KEYS = new Set<BrainctlConfigKey>(['apiBaseUrl']);

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage shared brainctl settings used by CLI and MCP');

  configCmd
    .command('status')
    .description('Print the active Brainctl platform API target')
    .action(async () => {
      const target = await resolveBrainctlApiTarget();
      console.log(`apiBaseUrl=${target.apiBaseUrl}`);
      console.log(`source=${target.source}`);
      console.log(`mode=${target.mode}`);
    });

  configCmd
    .command('get')
    .argument('<key>', 'Config key')
    .description('Print a shared brainctl config value')
    .action(async (key: string) => {
      const normalizedKey = parseConfigKey(key);
      const service = createBrainctlConfigService();
      const value = await service.get(normalizedKey);
      console.log(value ? `${normalizedKey}=${value}` : `${normalizedKey}=`);
    });

  configCmd
    .command('set')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .description('Set a shared brainctl config value')
    .action(async (key: string, value: string) => {
      const normalizedKey = parseConfigKey(key);
      const service = createBrainctlConfigService();
      await service.set(normalizedKey, value);
      console.log(`${normalizedKey}=${await service.get(normalizedKey)}`);
    });

  configCmd
    .command('unset')
    .argument('<key>', 'Config key')
    .description('Clear a shared brainctl config value')
    .action(async (key: string) => {
      const normalizedKey = parseConfigKey(key);
      const service = createBrainctlConfigService();
      await service.unset(normalizedKey);
      console.log(`unset ${normalizedKey}`);
    });
}

function parseConfigKey(key: string): BrainctlConfigKey {
  if (!SUPPORTED_KEYS.has(key as BrainctlConfigKey)) {
    throw new Error(`Unsupported config key "${key}". Use apiBaseUrl.`);
  }

  return key as BrainctlConfigKey;
}
