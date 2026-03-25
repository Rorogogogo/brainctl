import { runAgentProcess } from './process.js';
import type { Executor, ExecutorRunOptions, ExecutorResult } from './types.js';

export function createClaudeInvocation(context: string, options?: ExecutorRunOptions) {
  return {
    command: 'claude',
    args: ['-p'],
    agent: 'claude' as const,
    context,
    runOptions: options
  };
}

export class ClaudeExecutor implements Executor {
  public readonly agent = 'claude' as const;

  public async run(
    context: string,
    options?: ExecutorRunOptions
  ): Promise<ExecutorResult> {
    return await runAgentProcess(createClaudeInvocation(context, options));
  }
}
