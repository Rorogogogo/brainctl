import { useDndContext, useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { parseDragId, parseDropId } from './dnd.js';

export function DroppableZone({
  id,
  label,
  icon,
  count,
  children,
  hint,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const [expanded, setExpanded] = useState(true);
  const { active, over } = useDndContext();

  useEffect(() => {
    const onExpand = (): void => setExpanded(true);
    const onCollapse = (): void => setExpanded(false);
    window.addEventListener('brainctl:zones-expand', onExpand);
    window.addEventListener('brainctl:zones-collapse', onCollapse);
    return () => {
      window.removeEventListener('brainctl:zones-expand', onExpand);
      window.removeEventListener('brainctl:zones-collapse', onCollapse);
    };
  }, []);

  const isHighlighted = () => {
    if (!active || !over) return false;
    const source = parseDragId(active.id as string);
    const target = parseDropId(over.id as string);
    const thisZone = parseDropId(id);
    if (!source || !target || !thisZone) return false;

    return source.category === thisZone.category && target.agent === thisZone.agent;
  };

  const highlight = isHighlighted() || (isOver && !active);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-3 rounded-2xl p-4 transition-all duration-300 ${highlight ? 'bg-zinc-100 border-2 border-zinc-300 border-dashed shadow-inner' : 'bg-zinc-50/50 border border-zinc-200 border-dashed'} ${!expanded ? 'min-h-0 pb-4' : 'min-h-[120px]'}`}
    >
      <div
        className={`flex items-center justify-between gap-4 cursor-pointer select-none transition-colors hover:opacity-80 ${expanded ? 'border-b border-zinc-200/60 pb-2' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600">{icon}</span>
          <p className="text-xs font-semibold text-zinc-600 m-0">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex min-w-[28px] items-center justify-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600 shadow-sm">{count}</span>
          <span className="text-zinc-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </div>
      </div>
      {expanded && (
        <div className="grid gap-2 relative">
          {hint && (
            <div className="rounded-md bg-zinc-100/70 px-2.5 py-1 text-[11px] text-zinc-500">
              {hint}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
