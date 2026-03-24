export type AgentName = 'claude' | 'codex';

export type ErrorCategory = 'user' | 'system';
export type DiagnosticStatus = 'ok' | 'warn' | 'error';

export interface SkillConfig {
  description?: string;
  prompt: string;
}

export interface BrainctlConfig {
  configPath: string;
  rootDir: string;
  memory: {
    paths: string[];
  };
  skills: Record<string, SkillConfig>;
  mcps: Record<string, unknown>;
}

export interface MemoryLoadResult {
  content: string;
  files: string[];
  count: number;
}

export interface RunRequest {
  cwd?: string;
  skill: string;
  inputFile: string;
  primaryAgent: AgentName;
  fallbackAgent?: AgentName;
}

export interface ExecutionStep {
  skill: string;
  inputFile: string;
  primaryAgent: AgentName;
  fallbackAgent?: AgentName;
  usePreviousOutput?: boolean;
}

export interface ExecutionStepResult {
  stepIndex: number;
  requestedAgent: AgentName;
  agent: AgentName;
  fallbackUsed: boolean;
  exitCode: number;
  output: string;
}

export interface ExecutionTrace {
  steps: ExecutionStepResult[];
  finalOutput: string;
  finalExitCode: number;
}

export interface DiagnosticCheck {
  label: string;
  status: DiagnosticStatus;
  message: string;
}
