import pc from 'picocolors';

import { BrainctlError } from './errors.js';
import type { DiagnosticStatus } from './types.js';

export function printError(error: unknown): void {
  console.error(formatError(error));
}

export function formatError(error: unknown): string {
  if (error instanceof BrainctlError) {
    const prefix = error.category === 'user' ? 'Error' : 'System error';
    return pc.red(`${prefix}: ${error.message}`);
  }

  if (error instanceof Error) {
    return pc.red(`System error: ${error.message}`);
  }

  return pc.red('System error: An unknown failure occurred.');
}

export function formatDiagnosticStatus(status: DiagnosticStatus): string {
  switch (status) {
    case 'ok':
      return pc.green('OK');
    case 'warn':
      return pc.yellow('WARN');
    case 'error':
      return pc.red('ERROR');
  }
}
