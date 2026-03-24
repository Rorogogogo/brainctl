import { runAgentProcess } from './process.js';
import type { Executor, ExecutorRunOptions, ExecutorResult } from './types.js';

export class CodexExecutor implements Executor {
  public readonly agent = 'codex' as const;

  public async run(
    context: string,
    options?: ExecutorRunOptions
  ): Promise<ExecutorResult> {
    return await runAgentProcess({
      command: 'codex',
      agent: this.agent,
      context,
      runOptions: options
    });
  }
}
