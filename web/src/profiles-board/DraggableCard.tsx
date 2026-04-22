import { useDraggable } from '@dnd-kit/core';
import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

export function DraggableCard({
  id,
  label,
  sublabel,
  icon,
  status,
  onRemove,
  editable,
}: {
  id: string;
  label: string;
  sublabel: string;
  icon?: ReactNode;
  status?: 'added' | 'removed';
  onRemove?: () => void;
  editable: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id, disabled: !editable });

  const statusClass =
    status === 'added'
      ? ' border-emerald-200 bg-emerald-50/50 shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-400/20'
      : status === 'removed'
      ? ' border-red-200 bg-red-50 opacity-50 line-through'
      : ' border-zinc-200 bg-white hover:border-zinc-300';

  const editableClass = editable
    ? ' cursor-grab active:cursor-grabbing hover:shadow-sm'
    : '';

  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`flex items-start gap-3 rounded-xl border p-3 transition-all duration-200 group ${isDragging ? 'opacity-50' : ''}${statusClass}${editableClass}`}
      {...dragProps}
    >
      <div className="flex w-full items-start gap-3">
        {icon ? <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 transition-colors group-hover:text-zinc-900">{icon}</span> : null}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-sm font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        </div>
        {status && (
          <span className={`inline-flex shrink-0 items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium leading-none ${status === 'added' ? 'bg-zinc-100 text-zinc-700' : 'bg-red-100 text-red-700'}`}>
            {status === 'added' ? 'Added' : 'Removed'}
          </span>
        )}
        {onRemove && !status && (
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            title={`Remove ${label}`}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
