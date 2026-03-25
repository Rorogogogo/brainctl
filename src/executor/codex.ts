import { runAgentProcess } from './process.js';
import type { Executor, ExecutorRunOptions, ExecutorResult } from './types.js';

export function createCodexInvocation(context: string, options?: ExecutorRunOptions) {
  return {
    command: 'codex',
    args: ['exec', '--skip-git-repo-check', '-'],
    agent: 'codex' as const,
    context,
    runOptions: options
  };
}

export class CodexExecutor implements Executor {
  public readonly agent = 'codex' as const;

  public async run(
    context: string,
    options?: ExecutorRunOptions
  ): Promise<ExecutorResult> {
    return await runAgentProcess(createCodexInvocation(context, options));
  }
}
