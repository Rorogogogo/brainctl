import { useDroppable } from '@dnd-kit/core';

import { AgentLogo } from '../../components/agent-brand.js';
import { AGENT_LABELS } from '../profiles-view.js';
import type { DragCategory } from './dnd.js';
import { parseDragId } from './dnd.js';

const CATEGORY_LABEL: Record<DragCategory, string> = {
  mcp: 'MCP',
  skill: 'skill',
  plugin: 'plugin',
};

const CATEGORY_PLURAL: Record<DragCategory, string> = {
  mcp: 'mcps',
  skill: 'skills',
  plugin: 'plugins',
};

function TraySlot({
  agent,
  category,
}: {
  agent: string;
  category: DragCategory;
}) {
  const dropId = `tray:${agent}:${CATEGORY_PLURAL[category]}`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[140px] items-center gap-2 rounded-xl border-2 border-dashed px-3 py-2.5 transition-all ${
        isOver
          ? 'border-emerald-400 bg-emerald-50 scale-105 shadow-lg'
          : 'border-zinc-300 bg-white hover:border-zinc-400'
      }`}
    >
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-50">
        <AgentLogo agent={agent} className="size-5 object-contain" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-zinc-900 leading-tight truncate">
          {AGENT_LABELS[agent] ?? agent}
        </span>
        <span className="text-[11px] text-zinc-500 leading-tight">
          Drop {category}
        </span>
      </div>
    </div>
  );
}

export function DropTray({
  activeId,
  configs,
}: {
  activeId: string | null;
  configs: Array<{ agent: string }>;
}) {
  const visible = activeId !== null;
  const parsed = activeId ? parseDragId(activeId) : null;
  const targets = parsed
    ? configs.filter((c) => c.agent !== parsed.agent).map((c) => c.agent)
    : [];

  return (
    <div
      aria-hidden={!visible}
      style={{ visibility: visible ? 'visible' : 'hidden' }}
      className={`fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 transition-opacity duration-150 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex max-w-full items-center gap-3 overflow-x-auto rounded-2xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur">
        <div className="flex shrink-0 flex-col pr-3 border-r border-zinc-200">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Drop on
          </span>
          <span className="text-xs font-medium text-zinc-600">
            {parsed ? `${CATEGORY_LABEL[parsed.category]} target` : ''}
          </span>
        </div>
        {parsed
          ? targets.map((agent) => (
              <TraySlot key={agent} agent={agent} category={parsed.category} />
            ))
          : null}
      </div>
    </div>
  );
}
