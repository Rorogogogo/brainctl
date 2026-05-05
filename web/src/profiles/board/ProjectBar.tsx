import { useEffect, useState } from 'react';
import { fetchJson } from '../../lib/fetch-json.js';

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

export function ProjectBar({
  scope,
  onScopeChange,
  activeProject,
  onActiveProjectChange,
}: ProjectBarProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [claudeProjects, setClaudeProjects] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [manualPath, setManualPath] = useState('');

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
    setOpen(false);
    onActiveProjectChange(path);
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

  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm font-medium text-zinc-800"
        >
          {activeProject || '—'}
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-96 rounded-md border border-zinc-200 bg-white shadow-lg">
            {sections.recents.length > 0 && (
              <Section title="Recents" items={sections.recents} onPick={pick} />
            )}
            {sections.claudeOnly.length > 0 && (
              <Section title="Claude projects" items={sections.claudeOnly} onPick={pick} />
            )}
            <div className="border-t border-zinc-200 p-2">
              <label className="text-[11px] font-medium text-zinc-500">Add path</label>
              <div className="mt-1 flex gap-1">
                <input
                  className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  placeholder="/absolute/path/to/project"
                />
                <button
                  type="button"
                  className="rounded bg-zinc-900 px-2 py-1 text-sm text-white"
                  onClick={() => {
                    if (manualPath) {
                      pick(manualPath);
                      setManualPath('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 rounded-md bg-zinc-200 p-0.5">
        <button
          type="button"
          onClick={() => onScopeChange('global')}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            scope === 'global' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Global
        </button>
        <button
          type="button"
          onClick={() => onScopeChange('project')}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            scope === 'project' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Project
        </button>
      </div>

      {scope === 'project' && (
        <div className="font-mono text-[11px] text-zinc-500" title={activeProject}>
          {activeProject}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  onPick,
}: {
  title: string;
  items: string[];
  onPick: (p: string) => void;
}): JSX.Element {
  return (
    <div className="border-b border-zinc-200 last:border-b-0">
      <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-zinc-500">{title}</div>
      <ul>
        {items.map((p) => (
          <li key={p}>
            <button
              type="button"
              className="block w-full truncate px-2 py-1 text-left text-sm hover:bg-zinc-100"
              onClick={() => onPick(p)}
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
