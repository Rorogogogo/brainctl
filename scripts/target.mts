/**
 * Dev-only switch for the Brainctl platform backend (publish / sign-in / MCP).
 *
 * Writes the shared `~/.brainctl/config.json` that every surface reads — the CLI,
 * the `ui` dashboard, and the MCP server Claude spawns — so one command flips all
 * of them at once. Not shipped to users (package.json publishes only `dist`).
 *
 *   npm run target            # show the active target
 *   npm run target local      # point everything at http://127.0.0.1:3877
 *   npm run target prod       # revert everything to production
 *   npm run target <url>      # point everything at a custom backend
 */
import {
  createBrainctlConfigService,
  resolveBrainctlApiTarget,
  resolveBrainctlFrontendUrl,
} from '../src/services/platform/brainctl-config-service.js';

const LOCAL_API_BASE_URL = 'http://127.0.0.1:3877';

const service = createBrainctlConfigService();
const arg = process.argv[2];

async function printStatus(): Promise<void> {
  const target = await resolveBrainctlApiTarget();
  const web = await resolveBrainctlFrontendUrl({ apiBaseUrl: target.apiBaseUrl });
  console.log(`target: ${target.mode}`);
  console.log(`api:    ${target.apiBaseUrl}`);
  console.log(`web:    ${web}`);
  console.log(`source: ${target.source}  (config file: ${service.path()})`);
  if (target.source === 'env') {
    console.warn(
      '\n⚠  BRAINCTL_API_BASE_URL (or BRAINCTL_API_URL) is set in your shell and overrides this file.\n' +
        '   Unset it for the switch to take effect.'
    );
  }
}

switch (arg) {
  case undefined:
  case 'status':
    break;
  case 'prod':
    await service.unset('apiBaseUrl');
    break;
  case 'local':
    await service.set('apiBaseUrl', LOCAL_API_BASE_URL);
    break;
  default:
    await service.set('apiBaseUrl', arg);
}

await printStatus();
