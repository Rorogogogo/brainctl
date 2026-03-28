#!/usr/bin/env node

import { realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { registerDoctorCommand } from './commands/doctor.js';
import { registerInitCommand } from './commands/init.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerRunCommand } from './commands/run.js';
import { registerStatusCommand } from './commands/status.js';
import { registerUiCommand } from './commands/ui.js';
import { printError } from './output.js';
import { createDoctorService, type DoctorService } from './services/doctor-service.js';
import { createInitService, type InitService } from './services/init-service.js';
import { createRunService, type RunService } from './services/run-service.js';
import { createStatusService, type StatusService } from './services/status-service.js';
import { createExecutorResolver } from './executor/resolver.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

export interface CliServices {
  initService: InitService;
  runService: RunService;
  statusService: StatusService;
  doctorService: DoctorService;
}

export function createProgram(overrides: Partial<CliServices> = {}): Command {
  const services = createDefaultServices(overrides);
  const program = new Command();

  program
    .name('brainctl')
    .description('Manage repeatable AI environments for local agent workflows')
    .version(packageVersion.version);

  registerInitCommand(program, services.initService);
  registerStatusCommand(program, services.statusService);
  registerRunCommand(program, services.runService);
  registerDoctorCommand(program, services.doctorService);
  registerUiCommand(program);
  registerMcpCommand(program);

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }
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
  const resolver = createExecutorResolver();

  return {
    initService: createInitService(),
    runService: createRunService({ resolver }),
    statusService: createStatusService({ resolver }),
    doctorService: createDoctorService({ resolver }),
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
