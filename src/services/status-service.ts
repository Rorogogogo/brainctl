import {
  createAgentAvailabilityService,
  type AgentAvailability,
  type AgentAvailabilityService,
} from './agent-availability-service.js';
import { createProfileService, type ProfileService } from './profile-service.js';
import type { AgentName } from '../types.js';

export interface StatusResult {
  agents: Record<AgentName, AgentAvailability>;
  profiles: { count: number; names: string[] };
}

export interface StatusService {
  execute(options?: { cwd?: string }): Promise<StatusResult>;
}

export function createStatusService(
  dependencies: {
    availabilityService?: AgentAvailabilityService;
    profileService?: ProfileService;
  } = {}
): StatusService {
  const availabilityService =
    dependencies.availabilityService ?? createAgentAvailabilityService();
  const profileService = dependencies.profileService ?? createProfileService();

  return {
    async execute(options = {}): Promise<StatusResult> {
      const cwd = options.cwd ?? process.cwd();
      const [agents, profileList] = await Promise.all([
        availabilityService.getAll(),
        profileService.list({ cwd }),
      ]);

      return {
        agents,
        profiles: {
          count: profileList.profiles.length,
          names: profileList.profiles,
        },
      };
    },
  };
}
