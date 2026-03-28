import type { AgentName } from '../types.js';

export interface ExecutorRunOptions {
  streamOutput?: boolean;
  onOutputChunk?: (chunk: string) => void;
}

export interface ExecutorResult {
  output: string;
  exitCode: number;
  agent: AgentName;
}

export interface Executor {
  readonly agent: AgentName;
  run(context: string, options?: ExecutorRunOptions): Promise<ExecutorResult>;
}
