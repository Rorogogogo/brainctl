export type AgentName = 'claude' | 'codex' | 'gemini';

export type ErrorCategory = 'user' | 'system';
export type DiagnosticStatus = 'ok' | 'warn' | 'error';

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

export interface PortablePluginSnapshot {
  agent: AgentName;
  name: string;
  source: string;
  marketplace?: string;
  version?: string;
  archivePath: string;
  managed?: boolean;
  pluginSkills?: string[];
  pluginMcps?: string[];
  pluginAgents?: string[];
  pluginCommands?: string[];
}

export interface PortableUserSkillSnapshot {
  agent: AgentName;
  name: string;
  archivePath: string;
}

export interface PortableProfileManifest {
  schemaVersion: 1 | 2 | 3;
  profileName: string;
  createdBy?: {
    tool: string;
    version: string;
  };
  source?: PortableProfileSource;
  credentials?: PortableCredentialSpec[];
  plugins?: PortablePluginSnapshot[];
  userSkills?: PortableUserSkillSnapshot[];
}

export interface LocalNpmMcpServerConfig {
  kind: 'local';
  source: 'npm';
  package: string;
  env?: Record<string, string>;
}

export type McpRuntime = 'node' | 'python' | 'java' | 'go' | 'rust' | 'binary';

export interface LocalBundledMcpServerConfig {
  kind: 'local';
  source: 'bundled';
  runtime: McpRuntime;
  path: string;
  install?: string;
  command: string;
  args?: string[];
  exclude?: string[];
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
  mcps: Record<string, McpServerConfig>;
}

export interface SyncAgentResult {
  agent: AgentName;
  configPath: string;
  backedUpTo: string | null;
  mcpCount: number;
  pluginsInstalled?: string[];
  userSkillsInstalled?: string[];
  pluginsRemoved?: string[];
  userSkillsRemoved?: string[];
}

export type SyncResult = SyncAgentResult[];
