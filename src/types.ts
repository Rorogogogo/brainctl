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

export interface PortableCredentialSpec {
  key: string;
  required: boolean;
  description?: string;
}

// Placeholder values are persisted into portable profile archives instead of raw secrets.
// Redaction preserves already-placeholderized bearer/token forms as-is.
export type PortableCredentialPlaceholder = `\${credentials.${string}}`;
export type PortableCredentialPreservedValue =
  | PortableCredentialPlaceholder
  | `Bearer ${PortableCredentialPlaceholder}`
  | `Token ${PortableCredentialPlaceholder}`;

export type PortableProfileSource =
  | {
      kind: 'profile';
      profileName: string;
    }
  | {
      kind: 'agent';
      agent: AgentName;
    };

export interface PortableProfileManifest {
  schemaVersion: 1;
  profileName: string;
  createdBy?: {
    tool: string;
    version: string;
  };
  source?: PortableProfileSource;
  credentials?: PortableCredentialSpec[];
}

export interface LocalNpmMcpServerConfig {
  kind: 'local';
  source: 'npm';
  package: string;
  env?: Record<string, string>;
}

export interface LocalBundledMcpServerConfig {
  kind: 'local';
  source: 'bundled';
  path: string;
  install?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface RemoteMcpServerConfig {
  kind: 'remote';
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export type LocalMcpServerConfig = LocalNpmMcpServerConfig | LocalBundledMcpServerConfig;
export type McpServerConfig = LocalMcpServerConfig | RemoteMcpServerConfig;

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
