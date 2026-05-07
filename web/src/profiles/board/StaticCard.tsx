import { useDraggable } from '@dnd-kit/core';
import { Bot, ChevronDown, ChevronRight, FileText, FolderOpen, Server, Terminal, Trash2 } from 'lucide-react';
import { useState } from 'react';

function openFolder(folderPath: string) {
  void fetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  });
}

export function StaticCard({
  id,
  label,
  sublabel,
  details,
  status,
  onRemove,
  editable,
  folderPath,
}: {
  id: string;
  label: string;
  sublabel: string;
  details?: Array<{ name: string; kind: 'skill' | 'mcp' | 'agent' | 'command' }>;
  status?: 'added' | 'removed';
  onRemove?: () => void;
  editable: boolean;
  folderPath?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !editable });
  const [expanded, setExpanded] = useState(false);

  const statusClass =
    status === 'added'
      ? ' border-emerald-200 bg-emerald-50/50 shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-400/20'
      : status === 'removed'
      ? ' border-red-200 bg-red-50 opacity-50 line-through'
      : ' border-zinc-200 bg-white hover:border-zinc-300';

  const editableClass = editable
    ? ' cursor-grab active:cursor-grabbing hover:shadow-sm'
    : '';

  const detailCount = details?.length ?? 0;
  const hasDetails = detailCount > 0;
  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col items-start gap-2 rounded-xl border p-3 transition-all duration-200 group ${isDragging ? 'opacity-50' : ''}${statusClass}${editableClass}`}
      {...dragProps}
    >
      <div className="flex w-full items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-sm font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        </div>
        {status ? (
          <span className={`inline-flex shrink-0 items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium leading-none ${status === 'added' ? 'bg-zinc-100 text-zinc-700' : 'bg-red-100 text-red-700'}`}>
            {status === 'added' ? 'Added' : 'Removed'}
          </span>
        ) : null}
        {folderPath && !status ? (
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => openFolder(folderPath)}
            title={`Reveal in Finder: ${folderPath}`}
          >
            <FolderOpen size={15} />
          </button>
        ) : null}
        {hasDetails ? (
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : null}
        {onRemove && !status ? (
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            title={`Remove ${label}`}
          >
            <Trash2 size={16} />
          </button>
        ) : null}
      </div>
      {hasDetails && expanded ? (
        <div className="flex flex-wrap gap-2 pt-2 w-full border-t border-zinc-100 mt-1">
          {details!.map((item) => (
            <span
              key={`${item.kind}:${item.name}`}
              className={`inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-0.5 text-[11px] font-medium shadow-sm ${
                item.kind === 'mcp' ? 'border-indigo-200 text-indigo-700' :
                item.kind === 'agent' ? 'border-amber-200 text-amber-700' :
                item.kind === 'command' ? 'border-sky-200 text-sky-700' :
                'border-violet-200 text-violet-700'
              }`}
            >
              {item.kind === 'mcp' && <Server size={10} className="opacity-70" />}
              {item.kind === 'agent' && <Bot size={10} className="opacity-70" />}
              {item.kind === 'command' && <Terminal size={10} className="opacity-70" />}
              {item.kind === 'skill' && <FileText size={10} className="opacity-70" />}
              <span className="opacity-80 text-[10px] uppercase tracking-wider">{item.kind}</span>
              <span className="text-zinc-800">{item.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
