import type { Command } from 'commander';

import type { RunService } from '../services/run-service.js';
import type { AgentName } from '../types.js';

export function registerRunCommand(program: Command, runService: RunService): void {
  program
    .command('run')
    .description('Run a file through a configured skill and AI agent')
    .argument('<skill>', 'Skill name from ai-stack.yaml')
    .argument('<file>', 'Input file to send to the agent')
    .requiredOption('--with <agent>', 'Primary agent to run', validateAgentName)
    .option('--fallback <agent>', 'Fallback agent if the primary agent is unavailable', validateAgentName)
    .action(
      async (
        skill: string,
        inputFile: string,
        options: { with: AgentName; fallback?: AgentName }
      ) => {
        const trace = await runService.execute({
          cwd: process.cwd(),
          skill,
          inputFile,
          primaryAgent: options.with,
          fallbackAgent: options.fallback
        });

        process.exitCode = trace.finalExitCode;
      }
    );
}

function validateAgentName(value: string): AgentName {
  if (value !== 'claude' && value !== 'codex') {
    throw new Error(`Unsupported agent: ${value}`);
  }

  return value;
}
