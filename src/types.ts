export type AgentName = 'claude' | 'codex' | 'gemini';

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
  entries: Array<{
    path: string;
    content: string;
  }>;
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

// --- Profile & Sync types ---

export interface NpmMcpServerConfig {
  type: 'npm';
  package: string;
  env?: Record<string, string>;
}

export interface BundledMcpServerConfig {
  type: 'bundled';
  path: string;
  install?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServerConfig = NpmMcpServerConfig | BundledMcpServerConfig;

export interface ProfileConfig {
  name: string;
  description?: string;
  skills: Record<string, SkillConfig>;
  mcps: Record<string, McpServerConfig>;
  memory: {
    paths: string[];
  };
}

export interface BrainctlMetaConfig {
  active_profile: string;
  agents: AgentName[];
}

export interface SyncAgentResult {
  agent: AgentName;
  configPath: string;
  backedUpTo: string | null;
  mcpCount: number;
}

export type SyncResult = SyncAgentResult[];
