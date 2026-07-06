#!/usr/bin/env node

import { realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { registerConfigCommand } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerProfileCommand } from './commands/profile.js';
import { registerStatusCommand } from './commands/status.js';
import { registerUiCommand } from './commands/ui.js';
import { printError } from './output.js';
import { createUpdateCheckService } from './services/platform/update-check-service.js';
import { createDoctorService, type DoctorService } from './services/platform/doctor-service.js';
import { createProfileApplyService, type ProfileApplyService } from './services/profile/profile-apply-service.js';
import { createProfileExportService, type ProfileExportService } from './services/profile/profile-export-service.js';
import { createProfileImportService, type ProfileImportService } from './services/profile/profile-import-service.js';
import { createProfileService, type ProfileService } from './services/profile/profile-service.js';
import { createProfileSnapshotService, type ProfileSnapshotService } from './services/profile/profile-snapshot-service.js';
import { createStatusService, type StatusService } from './services/platform/status-service.js';
import { createAgentAvailabilityService } from './services/agent/agent-availability-service.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

export interface CliServices {
  statusService: StatusService;
  doctorService: DoctorService;
  profileService: ProfileService;
  profileExportService: ProfileExportService;
  profileImportService: ProfileImportService;
  profileApplyService: ProfileApplyService;
  profileSnapshotService: ProfileSnapshotService;
}

export function createProgram(overrides: Partial<CliServices> = {}): Command {
  const services = createDefaultServices(overrides);
  const program = new Command();

  program
    .name('brainctl')
    .description('Manage repeatable AI environments for local agent workflows')
    .version(packageVersion.version);

  registerStatusCommand(program, services.statusService);
  registerConfigCommand(program);
  registerDoctorCommand(program, services.doctorService);
  registerProfileCommand(program, {
    profileService: services.profileService,
    profileExportService: services.profileExportService,
    profileImportService: services.profileImportService,
    profileApplyService: services.profileApplyService,
    profileSnapshotService: services.profileSnapshotService,
  });
  registerUiCommand(program);
  registerMcpCommand(program);

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  // Deprecation notice on stderr only — never stdout, which MCP stdio owns.
  if (!process.env.BRAINCTL_NO_DEPRECATION_NOTICE) {
    process.stderr.write(
      '\n⚠ brainctl is now part of NoMoreIDE and no longer receives updates.\n' +
        '  Everything here (agent configs, profiles, the registry) lives on in:\n' +
        '    npm i -g nomoreide\n' +
        '  Migration guide: https://github.com/Rorogogogo/nomoreide/blob/main/docs/brainctl-migration.md\n' +
        '  Your registry account and published profiles keep working unchanged.\n\n'
    );
  }

  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }

  // Skip update check for MCP mode (handled in mcp command), non-TTY, opt-out, or local dev
  const isMcpCommand = argv.includes('mcp');
  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
  const isOptedOut = !!process.env.BRAINCTL_NO_UPDATE_CHECK;
  const isLocalDev = import.meta.url.includes('/src/');

  if (isMcpCommand || !isInteractive || isOptedOut || isLocalDev) return;

  try {
    const service = createUpdateCheckService();
    const check = await service.check();
    if (!check.isOutdated) return;

    const answer = await promptYesNo(
      `\n⚠ brainctl ${check.latest} is available (you have ${check.current}).\n  Update now? [Y/n] `
    );

    if (answer) {
      process.stderr.write('  Updating...\n');
      const result = await service.selfUpdate();
      if (result.success) {
        process.stderr.write(`  Updated to brainctl@${check.latest}\n`);
      } else {
        process.stderr.write(`  Update failed: ${result.error ?? 'unknown error'}\n`);
        process.stderr.write('  Run manually: npm install -g brainctl\n');
      }
    }
  } catch {
    // Update check failed — don't interrupt the user
  }
}

function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
    });
  });
}

export function shouldRunMain(
  entryPointPath: string | undefined,
  moduleUrl: string
): boolean {
  if (!entryPointPath) {
    return false;
  }

  return resolveRealPath(entryPointPath) === resolveRealPath(fileURLToPath(moduleUrl));
}

function createDefaultServices(overrides: Partial<CliServices>): CliServices {
  const availabilityService = createAgentAvailabilityService();
  const profileService = createProfileService();
  const profileSnapshotService = createProfileSnapshotService();

  return {
    statusService: createStatusService({ availabilityService }),
    doctorService: createDoctorService({ availabilityService }),
    profileService,
    profileExportService: createProfileExportService({ profileService }),
    profileImportService: createProfileImportService(),
    profileApplyService: createProfileApplyService({ profileService, snapshotService: profileSnapshotService }),
    profileSnapshotService,
    ...overrides
  };
}

if (shouldRunMain(process.argv[1], import.meta.url)) {
  void main();
}

function resolveRealPath(targetPath: string): string {
  const resolvedPath = path.resolve(targetPath);

  try {
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}
