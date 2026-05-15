import { ArrowRight, Folder, FolderSearch, Globe, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import FolderPicker from '../../components/FolderPicker.js';
import { fetchJson } from '../../lib/fetch-json.js';

export interface MoveMcpScopeSelection {
  toScope: 'global' | 'project';
  toProjectPath?: string;
}

function leafName(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

export interface MoveMcpScopePickerProps {
  agent: string;
  fromScope: 'global' | 'project';
  fromProjectPath?: string;
  activeProjectPath?: string;
  onConfirm: (selection: MoveMcpScopeSelection) => void;
  onCancel: () => void;
}

function ScopeOption({
  active,
  disabled,
  icon,
  label,
  detail,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: JSX.Element;
  label: string;
  detail?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      className={[
        'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-700 hover:bg-zinc-50',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <span className={active ? 'shrink-0 text-zinc-900' : 'shrink-0 text-zinc-500'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{label}</span>
      {detail && (
        <span className="ml-2 min-w-0 max-w-[55%] shrink truncate text-right font-mono text-[11px] text-zinc-400" title={detail}>
          {detail}
        </span>
      )}
    </button>
  );
}

type Selection =
  | { kind: 'global' }
  | { kind: 'project'; path: string };

export function MoveMcpScopePicker(p: MoveMcpScopePickerProps): JSX.Element {
  const claudeOnly = p.agent === 'claude';
  const initial: Selection =
    p.fromScope === 'global'
      ? p.activeProjectPath
        ? { kind: 'project', path: p.activeProjectPath }
        : { kind: 'project', path: '' }
      : { kind: 'global' };
  const [selection, setSelection] = useState<Selection>(initial);
  const [knownProjects, setKnownProjects] = useState<string[]>([]);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!claudeOnly) return;
    let cancelled = false;
    setLoadingProjects(true);
    fetchJson<{ projects: string[] }>('/api/agents/claude/projects')
      .then((res) => {
        if (cancelled) return;
        setKnownProjects(res.projects ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setKnownProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [claudeOnly]);

  const sourceLabel = useMemo(() => {
    if (p.fromScope === 'global') return 'Global';
    return p.fromProjectPath ? leafName(p.fromProjectPath) : 'Project';
  }, [p.fromScope, p.fromProjectPath]);

  const sourceFullPath = p.fromScope === 'project' ? p.fromProjectPath : undefined;

  const resolved = useMemo(() => {
    if (selection.kind === 'global') {
      return { toScope: 'global' as const, toProjectPath: undefined as string | undefined };
    }
    return { toScope: 'project' as const, toProjectPath: selection.path.trim() };
  }, [selection]);

  const sameLocation =
    resolved.toScope === p.fromScope &&
    (resolved.toScope === 'global' || resolved.toProjectPath === (p.fromProjectPath ?? ''));
  const needsProject =
    resolved.toScope === 'project' && claudeOnly && !(resolved.toProjectPath && resolved.toProjectPath.length > 0);
  const canConfirm = !sameLocation && !needsProject;

  const handleConfirm = (): void => {
    if (!canConfirm) return;
    p.onConfirm({
      toScope: resolved.toScope,
      toProjectPath: resolved.toScope === 'project' ? resolved.toProjectPath : undefined,
    });
  };

  const isProjectActive = (path: string): boolean =>
    selection.kind === 'project' && selection.path === path;

  // For non-claude agents, project scope means the active project only — no path list.
  const projectOptions = claudeOnly ? knownProjects : p.activeProjectPath ? [p.activeProjectPath] : [];
  const browsedPath =
    selection.kind === 'project' && selection.path && !projectOptions.includes(selection.path)
      ? selection.path
      : null;

  return (
    <div
      className="mt-3 border-t border-zinc-200/70 pt-3"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <span>Move from</span>
        <span className="truncate text-zinc-700" title={sourceFullPath}>{sourceLabel}</span>
        <ArrowRight size={11} className="shrink-0 text-zinc-400" />
        <span>to…</span>
      </div>

      <div className="mt-1.5 grid gap-0.5">
        <ScopeOption
          active={selection.kind === 'global'}
          icon={<Globe size={13} />}
          label="Global"
          onClick={() => setSelection({ kind: 'global' })}
        />

        {loadingProjects && (
          <p className="inline-flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-zinc-500">
            <Loader2 size={11} className="animate-spin" /> Loading projects…
          </p>
        )}

        {projectOptions.map((proj) => (
          <ScopeOption
            key={proj}
            active={isProjectActive(proj)}
            icon={<Folder size={13} />}
            label={leafName(proj)}
            detail={proj}
            onClick={() => setSelection({ kind: 'project', path: proj })}
          />
        ))}

        {browsedPath && (
          <ScopeOption
            active
            icon={<Folder size={13} />}
            label={leafName(browsedPath)}
            detail={browsedPath}
            onClick={() => setSelection({ kind: 'project', path: browsedPath })}
          />
        )}

        {claudeOnly && (
          <button
            type="button"
            onClick={() => setFolderPickerOpen(true)}
            onPointerDown={(event) => event.stopPropagation()}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <FolderSearch size={13} className="shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">Browse folder…</span>
          </button>
        )}
      </div>

      {sameLocation && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
          Source and destination match.
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={p.onCancel}
          onPointerDown={(event) => event.stopPropagation()}
          className="inline-flex h-7 items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 text-[12px] font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          onPointerDown={(event) => event.stopPropagation()}
          className="inline-flex h-7 items-center justify-center rounded-md bg-zinc-900 px-2.5 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stage move
        </button>
      </div>

      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        mode="dir"
        initialPath={
          selection.kind === 'project' && selection.path
            ? selection.path
            : p.activeProjectPath
        }
        title="Choose project folder"
        confirmLabel="Use this project"
        onSelect={(path) => {
          setFolderPickerOpen(false);
          setSelection({ kind: 'project', path });
        }}
      />
    </div>
  );
}
