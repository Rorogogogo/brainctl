import { ArrowRight, Loader2, Plus, Save, Shuffle, Undo2, X } from 'lucide-react';

import { AGENT_LABELS } from '../profiles-view.js';
import type { PendingChange } from '../profiles-view.js';

function leafName(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

function scopeLabel(scope: 'global' | 'project', projectPath?: string): string {
  if (scope === 'global') return 'global';
  return projectPath ? `project · ${leafName(projectPath)}` : 'project';
}

export function PendingChangesBar({
  changes,
  onUndoChange,
  onDiscardAll,
  onSave,
  saving,
}: {
  changes: PendingChange[];
  onUndoChange: (id: string) => void;
  onDiscardAll: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (changes.length === 0) return null;

  return (
    <div className="sticky top-6 z-20 grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-lg mb-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm font-semibold text-zinc-900 m-0">
          {changes.length} pending change{changes.length > 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50" onClick={onDiscardAll} disabled={saving}>
            <Undo2 size={16} /> Discard all
          </button>
          <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 shadow-sm" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{' '}
            Save & apply
          </button>
        </div>
      </div>
      <div className="grid gap-2">
        {changes.map((change) => {
          const isMove = change.type === 'move';
          const isAdd = change.type === 'add';
          const containerClass = isMove
            ? 'border-zinc-200 bg-white text-zinc-900'
            : isAdd
              ? 'border-zinc-200 bg-zinc-50 text-zinc-900'
              : 'border-red-200 bg-red-50 text-red-900';
          const badgeClass = isMove
            ? 'bg-white border border-zinc-200 text-zinc-600'
            : isAdd
              ? 'bg-white border border-zinc-200 text-zinc-600'
              : 'bg-white border border-red-200 text-red-600';
          const fromScope = change.fromScope ?? 'global';
          const toScope = change.toScope ?? change.scope;
          return (
          <div
            key={change.id}
            className={`flex items-center gap-3 rounded-xl border p-3 text-sm font-medium ${containerClass}`}
          >
            <span className={`grid size-8 place-items-center shrink-0 rounded-lg ${badgeClass}`}>
              {isMove ? <Shuffle size={16} /> : isAdd ? <Plus size={16} /> : <X size={16} />}
            </span>
            <span className="flex-1 min-w-0 truncate">
              <strong className="text-zinc-900">[{change.category}] {change.key}</strong>
              {isMove ? (
                <span className="ml-1 inline-flex items-center gap-1.5 text-zinc-600">
                  on {AGENT_LABELS[change.agent]}:
                  <span className="font-mono text-[12px] text-zinc-700" title={change.fromProjectPath}>
                    {scopeLabel(fromScope, change.fromProjectPath)}
                  </span>
                  <ArrowRight size={12} className="text-zinc-400" />
                  <span className="font-mono text-[12px] text-zinc-900" title={change.toProjectPath}>
                    {scopeLabel(toScope, change.toProjectPath)}
                  </span>
                </span>
              ) : isAdd ? (
                <>
                  {' '}→ {AGENT_LABELS[change.agent]}
                  {change.sourceAgent ? ` (from ${AGENT_LABELS[change.sourceAgent]})` : ''}
                </>
              ) : (
                <> removed from {AGENT_LABELS[change.agent]}</>
              )}
            </span>
            <button
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-white hover:border-zinc-200 hover:text-zinc-900 hover:shadow-sm"
              onClick={() => onUndoChange(change.id)}
              title="Undo this change"
              disabled={saving}
            >
              <Undo2 size={14} />
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
