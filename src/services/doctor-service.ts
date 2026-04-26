import {
  createAgentAvailabilityService,
  type AgentAvailabilityService,
} from './agent-availability-service.js';
import type { DiagnosticCheck } from '../types.js';

export interface DoctorResult {
  checks: DiagnosticCheck[];
  hasIssues: boolean;
}

export interface DoctorService {
  execute(options?: { cwd?: string }): Promise<DoctorResult>;
}

export function createDoctorService(
  dependencies: { availabilityService?: AgentAvailabilityService } = {}
): DoctorService {
  const availabilityService =
    dependencies.availabilityService ?? createAgentAvailabilityService();

  return {
    async execute(): Promise<DoctorResult> {
      const checks: DiagnosticCheck[] = [];
      const availability = await availabilityService.getAll();
      for (const agent of Object.values(availability)) {
        checks.push({
          label: 'Agent',
          status: agent.available ? 'ok' : 'warn',
          message: agent.available
            ? `${agent.agent} is available`
            : `${agent.agent} is not available on PATH`,
        });
      }
      return {
        checks,
        hasIssues: checks.some((c) => c.status !== 'ok'),
      };
    },
  };
}
