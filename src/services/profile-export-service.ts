import type { AgentName } from '../types.js';
import type { AgentConfigService } from './agent-config-service.js';
import { createPortableProfilePackService, type PortableProfilePackService } from './portable-profile-pack-service.js';
import type { ProfileService } from './profile-service.js';

export interface ProfileExportService {
  execute(options: {
    cwd?: string;
    source:
      | { source: 'profile'; name: string }
      | { source: 'agent'; agent: AgentName; cwd: string };
    outputPath?: string;
  }): Promise<{ archivePath: string }>;
}

interface ProfileExportDependencies {
  portableProfilePackService?: PortableProfilePackService;
  profileService?: Pick<ProfileService, 'get'>;
  agentConfigService?: Pick<AgentConfigService, 'readAll'>;
}

export function createProfileExportService(
  deps: ProfileExportDependencies = {}
): ProfileExportService {
  const portableProfilePackService =
    deps.portableProfilePackService ?? createPortableProfilePackService({
      profileService: deps.profileService,
      agentConfigService: deps.agentConfigService,
    });

  return {
    async execute(options) {
      return portableProfilePackService.execute({
        cwd: options.cwd,
        source: options.source,
        outputPath: options.outputPath,
      });
    },
  };
}
