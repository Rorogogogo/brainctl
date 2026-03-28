import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BookOpenText,
  Bot,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Database,
  FileText,
  LayoutDashboard,
  Workflow
} from 'lucide-react';

import RunView from './RunView';

type ViewKey = 'overview' | 'memory' | 'skills' | 'mcp' | 'run';

interface MemoryEntry {
  path: string;
  content: string;
}

interface AgentStatus {
  agent: 'claude' | 'codex';
  available: boolean;
  command?: string;
}

interface WorkspaceSnapshot {
  configPath: string;
  memory: {
    content: string;
    count: number;
    entries: MemoryEntry[];
    files: string[];
  };
  skills: string[];
  mcpCount: number;
  agents: Record<'claude' | 'codex', AgentStatus>;
}

interface SectionDefinition {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

const sections: SectionDefinition[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'memory', label: 'Memory', icon: BookOpenText },
  { key: 'skills', label: 'Skills', icon: FileText, disabled: true },
  { key: 'mcp', label: 'MCP', icon: Database, disabled: true },
  { key: 'run', label: 'Run', icon: Workflow }
];

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>('overview');
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [selectedMemoryPath, setSelectedMemoryPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkspace(): Promise<void> {
      try {
        setLoading(true);
        const response = await fetch('/api/overview', {
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => null)) as WorkspaceSnapshot | { error?: string } | null;

        if (!response.ok) {
          throw new Error(payload && typeof payload.error === 'string' ? payload.error : 'Failed to load workspace data.');
        }

        setWorkspace(payload as WorkspaceSnapshot);
        setError(null);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Failed to load workspace data.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadWorkspace();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    setSelectedMemoryPath((currentPath) => {
      if (currentPath && workspace.memory.entries.some((entry) => entry.path === currentPath)) {
        return currentPath;
      }

      return workspace.memory.entries[0]?.path ?? null;
    });
  }, [workspace]);

  const selectedMemory =
    workspace?.memory.entries.find((entry) => entry.path === selectedMemoryPath) ?? null;

  return (
    <main className="app-shell">
      <div className="shell">
        <header className="topbar panel">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              <Bot size={18} />
            </div>
            <div>
              <p className="eyebrow">brainctl local control panel</p>
              <h1>One workspace. Low friction.</h1>
            </div>
          </div>

          <div className="status-strip">
            <span className="status-chip">Local only</span>
            <span className="status-chip">Single project</span>
            <span className="status-chip">No auth</span>
          </div>
        </header>

        <div className="shell-grid">
          <aside className="nav-card panel" aria-label="Dashboard sections">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Views</p>
                <h2>Control surface</h2>
              </div>
              <span className="muted-pill">Monochrome</span>
            </div>

            <nav className="section-nav">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeView === section.key;

                return (
                  <button
                    key={section.key}
                    type="button"
                    className={`section-button${isActive ? ' is-active' : ''}${section.disabled ? ' is-disabled' : ''}`}
                    onClick={() => {
                      if (!section.disabled) {
                        setActiveView(section.key);
                      }
                    }}
                    disabled={section.disabled}
                    aria-disabled={section.disabled}
                  >
                    <span className="section-button-icon">
                      <Icon size={16} />
                    </span>
                    <span className="section-button-label">
                      <span>{section.label}</span>
                      <span className="section-button-subtitle">
                        {section.disabled ? 'Coming soon' : 'Open now'}
                      </span>
                    </span>
                    <ChevronRight size={16} className="section-button-chevron" aria-hidden="true" />
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="workspace-card panel">
            {loading ? (
              <EmptyState
                icon={LayoutDashboard}
                title="Loading workspace"
                message="Fetching the current project snapshot from the local backend."
              />
            ) : error ? (
              <EmptyState
                icon={CircleAlert}
                title="Could not load workspace"
                message={error}
              />
            ) : workspace ? (
              <>
                <div className="workspace-header">
                  <div>
                    <p className="eyebrow">Current project</p>
                    <h2>{basename(workspace.configPath) || 'ai-stack.yaml'}</h2>
                    <p className="muted-copy">{workspace.configPath}</p>
                  </div>
                  <div className="workspace-header-meta">
                    <span className="status-chip">
                      <CircleCheck size={14} />
                      Ready
                    </span>
                    <span className="status-chip">{workspace.memory.count} memory files</span>
                    <span className="status-chip">{workspace.mcpCount} MCP entries</span>
                  </div>
                </div>

                {activeView === 'overview' ? (
                  <OverviewView workspace={workspace} />
                ) : activeView === 'memory' ? (
                  <MemoryView
                    entries={workspace.memory.entries}
                    selectedPath={selectedMemoryPath}
                    selectedEntry={selectedMemory}
                    onSelectPath={setSelectedMemoryPath}
                  />
                ) : activeView === 'run' ? (
                  <RunView workspace={workspace} />
                ) : (
                  <ComingSoonView label={sectionLabel(activeView)} />
                )}
              </>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function OverviewView({ workspace }: { workspace: WorkspaceSnapshot }) {
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <MetricCard icon={BookOpenText} label="Memory files" value={String(workspace.memory.count)} note="Markdown files loaded from the current workspace." />
        <MetricCard icon={Database} label="MCP count" value={String(workspace.mcpCount)} note="Configured MCP entries in ai-stack.yaml." />
        <MetricCard
          icon={LayoutDashboard}
          label="Config path"
          value={workspace.configPath}
          note="The dashboard reads from this file."
          wide
        />
      </div>

      <section className="panel-inner">
        <div className="section-header">
          <div>
            <p className="eyebrow">Skills</p>
            <h3>{workspace.skills.length} defined skills</h3>
          </div>
          <span className="muted-pill">Sorted alphabetically</span>
        </div>

        <div className="chip-row">
          {workspace.skills.map((skill) => (
            <span key={skill} className="skill-chip">
              {skill}
            </span>
          ))}
        </div>
      </section>

      <section className="panel-inner">
        <div className="section-header">
          <div>
            <p className="eyebrow">Agents</p>
            <h3>Availability</h3>
          </div>
          <span className="muted-pill">Local executors</span>
        </div>

        <div className="agent-list">
          {(['claude', 'codex'] as const).map((agentName) => {
            const agent = workspace.agents[agentName];

            return (
              <div key={agentName} className="agent-row">
                <div className="agent-row-meta">
                  <span className={`agent-status-dot${agent.available ? ' is-online' : ' is-offline'}`} aria-hidden="true" />
                  <div>
                    <strong>{agentName}</strong>
                    <p>{agent.available ? 'Available now' : 'Unavailable right now'}</p>
                  </div>
                </div>
                <span className="agent-command">{agent.command ?? 'n/a'}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MemoryView({
  entries,
  selectedPath,
  selectedEntry,
  onSelectPath
}: {
  entries: MemoryEntry[];
  selectedPath: string | null;
  selectedEntry: MemoryEntry | null;
  onSelectPath: (path: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={BookOpenText}
        title="No memory files yet"
        message="Add markdown files to the configured memory path and they will appear here."
      />
    );
  }

  return (
    <div className="memory-layout">
      <aside className="panel-inner memory-list">
        <div className="section-header">
          <div>
            <p className="eyebrow">Markdown files</p>
            <h3>{entries.length} files</h3>
          </div>
          <span className="muted-pill">Read only</span>
        </div>

        <div className="memory-file-list" role="list">
          {entries.map((entry) => {
            const isSelected = entry.path === selectedPath;

            return (
              <button
                key={entry.path}
                type="button"
                className={`memory-file-button${isSelected ? ' is-selected' : ''}`}
                onClick={() => onSelectPath(entry.path)}
              >
                <strong>{basename(entry.path)}</strong>
                <span>{entry.path}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="panel-inner memory-preview">
        <div className="section-header">
          <div>
            <p className="eyebrow">Preview surface</p>
            <h3>{selectedEntry ? basename(selectedEntry.path) : 'Select a file'}</h3>
          </div>
          <span className="muted-pill">Monospace</span>
        </div>

        <p className="muted-copy">{selectedEntry?.path ?? 'Choose a markdown file from the list to inspect its contents.'}</p>

        <textarea
          className="memory-editor"
          readOnly
          spellCheck={false}
          value={selectedEntry?.content ?? ''}
          aria-label="Read-only memory preview"
        />
      </section>
    </div>
  );
}

function ComingSoonView({ label }: { label: string }) {
  return (
    <EmptyState
      icon={Workflow}
      title={`${label} is next`}
      message="The shell already reserves space for this view, but the first usable pass is Overview and Memory."
    />
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  wide = false
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  wide?: boolean;
}) {
  return (
    <article className={`metric-card${wide ? ' is-wide' : ''}`}>
      <div className="metric-card-header">
        <span className="metric-card-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className="metric-card-label">{label}</span>
      </div>
      <strong className="metric-card-value">{value}</strong>
      <p className="metric-card-note">{note}</p>
    </article>
  );
}

function EmptyState({
  icon: Icon,
  title,
  message
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function sectionLabel(view: ViewKey): string {
  return sections.find((section) => section.key === view)?.label ?? 'Section';
}
