import { spawn } from 'node:child_process';

import { ExecutionError } from '../errors.js';
import type { AgentName } from '../types.js';
import type { ExecutorResult, ExecutorRunOptions } from './types.js';

interface RunAgentProcessOptions {
  command: string;
  args?: string[];
  agent: AgentName;
  context: string;
  runOptions?: ExecutorRunOptions;
}

export async function runAgentProcess(
  options: RunAgentProcessOptions
): Promise<ExecutorResult> {
  return await new Promise<ExecutorResult>((resolve, reject) => {
    const child = spawn(options.command, options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;

      if (options.runOptions?.streamOutput !== false) {
        process.stdout.write(chunk);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;

      if (options.runOptions?.streamOutput !== false) {
        process.stderr.write(chunk);
      }
    });

    child.on('error', (error) => {
      reject(
        new ExecutionError(`Failed to start ${options.agent}: ${error.message}`)
      );
    });

    child.on('close', (code) => {
      resolve({
        output,
        exitCode: code ?? 1,
        agent: options.agent
      });
    });

    child.stdin.on('error', () => {
      // Ignore broken-pipe behavior if the child exits before stdin completes.
    });
    child.stdin.end(options.context);
  });
}
