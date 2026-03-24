import { runAgentProcess } from './process.js';
import type { Executor, ExecutorRunOptions, ExecutorResult } from './types.js';

export class ClaudeExecutor implements Executor {
  public readonly agent = 'claude' as const;

  public async run(
    context: string,
    options?: ExecutorRunOptions
  ): Promise<ExecutorResult> {
    return await runAgentProcess({
      command: 'claude',
      agent: this.agent,
      context,
      runOptions: options
    });
  }
}
