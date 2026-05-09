import type { McpServerConfig } from '../../types.js';

export interface AgentWriteOptions {
  mcpServers: Record<string, McpServerConfig>;
  cwd: string;
  // When true, preserve existing live MCP entries that aren't in mcpServers
  // (additive overlay). When false/undefined, replace the entire MCP block.
  merge?: boolean;
}

export interface AgentWriteResult {
  configPath: string;
  backedUpTo: string | null;
}

export interface AgentConfigWriter {
  write(options: AgentWriteOptions): Promise<AgentWriteResult>;
  restore(options: { cwd: string }): Promise<{ restoredFrom: string }>;
}

export function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
