import { type Modifier } from '@dnd-kit/core';
import { ArrowRightLeft } from 'lucide-react';

export function DragOverlayCard({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg rotate-2">
      <div className="flex w-full items-start gap-3 text-zinc-900">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600">
          <ArrowRightLeft size={16} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-sm font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        </div>
      </div>
    </div>
  );
}

export const snapToPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (activatorEvent && draggingNodeRect) {
    const event = activatorEvent as PointerEvent;
    const offsetX = event.clientX - draggingNodeRect.left;
    const offsetY = event.clientY - draggingNodeRect.top;
    return {
      ...transform,
      x: transform.x + offsetX - 20,
      y: transform.y + offsetY - 20,
    };
  }

  return transform;
};
