// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentColumn } from '../../web/src/profiles/board/AgentColumn.js';
import type { AgentLiveConfig } from '../../web/src/profiles-view.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG: AgentLiveConfig = {
  agent: 'codex',
  configPath: '/tmp/config.toml',
  exists: true,
  mcpServers: {
    docs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
  },
  remoteMcpServers: {},
  projectMcpServers: {},
  projectRemoteMcpServers: {},
  skills: [
    { name: 'notes', source: 'local', kind: 'skill' },
    {
      name: 'demo',
      source: 'market',
      kind: 'plugin',
      managed: true,
      pluginSkills: ['inner'],
    },
  ],
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('AgentColumn', () => {
  it('shows delete-all actions for each section in edit mode', async () => {
    const onStagedRemove = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          DndContext,
          null,
          createElement(AgentColumn, {
            config: CONFIG,
            scope: 'global',
            pendingAdded: new Set(),
            pendingRemoved: new Set(),
            pendingProjectAdded: new Set(),
            pendingProjectRemoved: new Set(),
            pendingSkillAdded: new Set(),
            pendingSkillRemoved: new Set(),
            pendingPluginAdded: new Set(),
            pendingPluginRemoved: new Set(),
            onStagedRemove,
            editable: true,
          })
        )
      );
    });

    const deleteAllButtons = Array.from(document.body.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === 'Delete all'
    );

    expect(deleteAllButtons).toHaveLength(3);

    await act(async () => {
      deleteAllButtons[0].click();
    });

    expect(onStagedRemove).toHaveBeenCalledWith('codex', 'skill', 'notes', 'global');

    await act(async () => {
      root.unmount();
    });
  });
});
