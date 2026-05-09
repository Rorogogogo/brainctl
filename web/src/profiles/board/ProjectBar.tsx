import { useEffect, useState } from 'react';
import { Clipboard, Folder, FolderOpen } from 'lucide-react';
import { fetchJson } from '../../lib/fetch-json.js';
import FolderPicker from '../../components/FolderPicker.js';
import { Dropdown, type DropdownSection } from '../../components/ui/Dropdown.js';

export interface ProjectBarProps {
  scope: 'global' | 'project';
  onScopeChange: (scope: 'global' | 'project') => void;
  activeProject: string;
  onActiveProjectChange: (next: string) => void;
}

export interface PickerSections {
  recents: string[];
  claudeOnly: string[];
}

export function buildPickerSections(input: {
  current: string;
  claudeProjects: string[];
  recents: string[];
}): PickerSections {
  const exclude = new Set([input.current, ...input.recents]);
  return {
    recents: input.recents.slice(),
    claudeOnly: input.claudeProjects.filter((p) => !exclude.has(p)),
  };
}

function basename(p: string): string {
  if (!p) return '';
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || '/';
}

function dirname(p: string): string {
  if (!p) return '';
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx === -1) return '';
  return trimmed.slice(0, idx) || '/';
}

export function ProjectBar({
  scope,
  onScopeChange,
  activeProject,
  onActiveProjectChange,
}: ProjectBarProps): JSX.Element {
  const [claudeProjects, setClaudeProjects] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [pastedPath, setPastedPath] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchJson<{
          current: string;
          claudeProjects: string[];
          recents: string[];
        }>('/api/projects');
        setClaudeProjects(res.claudeProjects);
        setRecents(res.recents);
      } catch {
        // leave empty; only current cwd is selectable
      }
    })();
  }, []);

  function pick(path: string): void {
    onActiveProjectChange(path);
    if (scope === 'global') {
      onScopeChange('project');
    }
    void fetchJson('/api/projects/recent', {
      method: 'POST',
      body: JSON.stringify({ cwd: path }),
    }).catch(() => {});
  }

  const sections = buildPickerSections({
    current: activeProject,
    claudeProjects,
    recents,
  });

  const projectSections: DropdownSection[] = [];
  if (sections.recents.length > 0) {
    projectSections.push({
      title: 'Recents',
      items: sections.recents.map((p) => ({
        value: p,
        label: basename(p),
        description: dirname(p) || p,
      })),
    });
  }
  if (sections.claudeOnly.length > 0) {
    projectSections.push({
      title: 'Claude projects',
      items: sections.claudeOnly.map((p) => ({
        value: p,
        label: basename(p),
        description: dirname(p) || p,
      })),
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
      <Dropdown
        leftIcon={<FolderOpen size={12} />}
        triggerLabel={basename(activeProject) || '—'}
        sections={projectSections}
        value={activeProject}
        onSelect={pick}
        emptyLabel="No recent projects"
        width="w-96"
        triggerClassName="inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 text-[12px] font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-50"
        labelClassName="max-w-[150px] truncate"
        footer={
          <div className="space-y-2">
            <div className="rounded-md border border-zinc-200 bg-white px-2 py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Current path
              </div>
              <div className="mt-0.5 break-all font-mono text-[11px] leading-snug text-zinc-700">
                {activeProject}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Paste absolute path
              </label>
              <div className="mt-1 flex gap-1">
                <input
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[12px] text-zinc-800 focus:border-zinc-400 focus:outline-none"
                  value={pastedPath}
                  onChange={(e) => {
                    setPastedPath(e.target.value);
                    setPasteError(null);
                  }}
                  placeholder="/Users/you/projects/app"
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = pastedPath.trim();
                    if (!trimmed.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
                      setPasteError('Path must be absolute');
                      return;
                    }
                    setPastedPath('');
                    setPasteError(null);
                    pick(trimmed);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800"
                >
                  <Clipboard size={12} /> Add
                </button>
              </div>
              {pasteError && (
                <div className="mt-1 text-[11px] text-red-600">{pasteError}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFolderPickerOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Folder size={14} className="text-zinc-500" /> Browse folder…
            </button>
          </div>
        }
      />

      <div
        className="flex h-7 items-center gap-1 rounded-lg bg-zinc-200 p-0.5"
        title="Global = MCPs/skills shared across all projects. Project = scoped to the selected project folder."
      >
        <button
          type="button"
          onClick={() => onScopeChange('global')}
          title="Show config shared across all projects"
          className={`h-6 rounded-md px-2 text-[11px] font-medium leading-6 transition-colors ${
            scope === 'global' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Global
        </button>
        <button
          type="button"
          onClick={() => onScopeChange('project')}
          title="Show config scoped to the selected project"
          className={`h-6 rounded-md px-2 text-[11px] font-medium leading-6 transition-colors ${
            scope === 'project' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Project
        </button>
      </div>

      {scope === 'project' && (
        <div className="relative group min-w-0">
          <div
            className="min-w-0 max-w-[clamp(10rem,24vw,26rem)] truncate font-mono text-[11px] text-zinc-500"
            tabIndex={0}
          >
            {activeProject}
          </div>
          <span
            className="pointer-events-none absolute left-0 top-full z-10 mt-1.5 w-max whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-left font-mono text-[10px] font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {activeProject}
          </span>
        </div>
      )}

      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        mode="dir"
        initialPath={activeProject}
        title="Choose project folder"
        confirmLabel="Use this project"
        onSelect={(p) => {
          setFolderPickerOpen(false);
          pick(p);
        }}
      />
    </div>
  );
}
