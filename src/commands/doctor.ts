import type { Command } from 'commander';

import { formatDiagnosticStatus } from '../output.js';
import type { DoctorService } from '../services/doctor-service.js';

export function registerDoctorCommand(program: Command, doctorService: DoctorService): void {
  program
    .command('doctor')
    .description('Validate the local brainctl setup')
    .action(async () => {
      const result = await doctorService.execute({ cwd: process.cwd() });

      for (const check of result.checks) {
        console.log(`${formatDiagnosticStatus(check.status)} ${check.label}: ${check.message}`);
      }

      process.exitCode = result.hasIssues ? 1 : 0;
    });
}
