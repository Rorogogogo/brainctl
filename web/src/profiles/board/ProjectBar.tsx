import { useEffect, useState } from 'react';
import { Folder, FolderOpen, Layers } from 'lucide-react';
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

interface ProfileApplyState {
  status: 'idle' | 'pending' | 'success' | 'error';
  name?: string;
  message?: string;
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

  const [profiles, setProfiles] = useState<string[]>([]);
  const [profileApply, setProfileApply] = useState<ProfileApplyState>({ status: 'idle' });

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

  const loadProfiles = async (): Promise<void> => {
    try {
      const res = await fetchJson<{ profiles: string[] }>('/api/profiles');
      setProfiles(res.profiles);
    } catch {
      setProfiles([]);
    }
  };

  useEffect(() => {
    void loadProfiles();
    const refresh = (): void => {
      void loadProfiles();
    };
    window.addEventListener('brainctl:profiles-changed', refresh);
    return () => window.removeEventListener('brainctl:profiles-changed', refresh);
  }, []);

  function pick(path: string): void {
    onActiveProjectChange(path);
    void fetchJson('/api/projects/recent', {
      method: 'POST',
      body: JSON.stringify({ cwd: path }),
    }).catch(() => {});
  }

  async function applyProfile(name: string): Promise<void> {
    setProfileApply({ status: 'pending', name });
    try {
      await fetchJson(`/api/profiles/${encodeURIComponent(name)}/apply`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setProfileApply({ status: 'success', name });
      window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
      setTimeout(() => setProfileApply({ status: 'idle' }), 2000);
    } catch (err) {
      setProfileApply({
        status: 'error',
        name,
        message: err instanceof Error ? err.message : 'Apply failed',
      });
    }
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

  const profileSections: DropdownSection[] = [
    {
      title: profiles.length > 0 ? 'Apply profile' : undefined,
      items: profiles.map((name) => ({
        value: name,
        label: name,
        description: 'Apply across all agents',
      })),
    },
  ];

  const profileTriggerLabel =
    profileApply.status === 'pending'
      ? `Applying ${profileApply.name}…`
      : profileApply.status === 'success'
        ? `Applied ${profileApply.name}`
        : profileApply.status === 'error'
          ? `Failed: ${profileApply.name}`
          : 'Choose profile…';

  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
      <Dropdown
        leftIcon={<FolderOpen size={13} />}
        triggerLabel={basename(activeProject) || '—'}
        sections={projectSections}
        value={activeProject}
        onSelect={pick}
        emptyLabel="No recent projects"
        width="w-96"
        footer={
          <button
            type="button"
            onClick={() => setFolderPickerOpen(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <Folder size={14} className="text-zinc-500" /> Browse folder…
          </button>
        }
      />

      <Dropdown
        leftIcon={<Layers size={13} />}
        triggerLabel={profileTriggerLabel}
        sections={profileSections}
        onSelect={(name) => void applyProfile(name)}
        emptyLabel="No profiles yet"
        width="w-72"
        footer={
          profileApply.status === 'error' ? (
            <div className="text-[11px] text-red-600">{profileApply.message}</div>
          ) : undefined
        }
      />

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
