import { pointerWithin, type CollisionDetection } from '@dnd-kit/core';

export type DragCategory = 'mcp' | 'skill' | 'plugin';
export type DropCategory = DragCategory | 'column';

export function parseDragId(id: string): { agent: string; category: DragCategory; key: string } | null {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const category = parts[1] as DragCategory;
  if (category !== 'mcp' && category !== 'skill' && category !== 'plugin') return null;
  return { agent: parts[0], category, key: parts.slice(2).join(':') };
}

export function parseDropId(id: string): { agent: string; category: DropCategory } | null {
  const trayMatch = id.match(/^tray:(\w+):(mcps|skills|plugins)$/);
  if (trayMatch) {
    return {
      agent: trayMatch[1],
      category: trayMatch[2] === 'mcps' ? 'mcp' : trayMatch[2] === 'skills' ? 'skill' : 'plugin',
    };
  }

  const match = id.match(/^(\w+):(mcps|skills|plugins|column)(?::anchor)?$/);
  if (!match) return null;

  return {
    agent: match[1],
    category: match[2] === 'mcps' ? 'mcp' : match[2] === 'skills' ? 'skill' : match[2] === 'plugins' ? 'plugin' : 'column',
  };
}

export function resolveCrossAgentDropId(activeId: string, overId: string): string | null {
  const source = parseDragId(activeId);
  const target = parseDropId(overId);
  if (!source || !target) return null;
  if (target.agent === source.agent) return null;

  const correctCategory = source.category === 'mcp' ? 'mcps' : source.category === 'skill' ? 'skills' : 'plugins';
  return `${target.agent}:${correctCategory}:anchor`;
}

export const customCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length === 0) return pointerCollisions;

  const trayHit = pointerCollisions.find((c) => typeof c.id === 'string' && (c.id as string).startsWith('tray:'));
  if (trayHit) return [trayHit];

  const correctZoneId = resolveCrossAgentDropId(args.active.id as string, pointerCollisions[0].id as string);
  if (!correctZoneId) return pointerCollisions;

  const correctDroppable = args.droppableContainers.find((container) => container.id === correctZoneId);
  if (!correctDroppable) return pointerCollisions;

  return [{ id: correctZoneId, data: correctDroppable.data, value: 100 }];
};
