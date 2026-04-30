import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { toast } from 'sonner';

import { fetchJson } from '../../lib/fetch-json.js';
import {
  AGENT_LABELS,
  applyPendingChangesWithApi,
  canStagePendingAddition,
  formatPluginSubtitle,
  splitAgentSkillEntries,
  type AgentLiveConfig,
  type PendingChange,
} from '../profiles-view.js';
import { parseDragId, parseDropId } from './dnd.js';

interface McpPreflightResult {
  ok: boolean;
  checks: Array<{
    label: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
  }>;
}

interface SkillPreflightResult {
  ok: boolean;
  checks: Array<{
    label: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
  }>;
}

interface PendingKeyMaps {
  added: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
  skillAdded: Map<string, Set<string>>;
  skillRemoved: Map<string, Set<string>>;
  pluginAdded: Map<string, Set<string>>;
  pluginRemoved: Map<string, Set<string>>;
}

export interface OverlayData {
  label: string;
  sublabel: string;
}

interface FinalizeResolvedPendingAdditionOptions {
  startedPreflightGeneration: number;
  currentPreflightGeneration: number;
  isEditMode: boolean;
  agentConfigs: AgentLiveConfig[];
  pendingChanges: PendingChange[];
  nextChange: PendingChange;
}

interface FinalizeResolvedPendingAdditionResult {
  changes: PendingChange[];
  didStage: boolean;
  error: string | null;
  reason: 'staged' | 'stale' | 'duplicate' | 'conflict';
}

let changeIdCounter = 0;

function nextChangeId(): string {
  return `change-${++changeIdCounter}`;
}

export function applyPendingChanges(
  configs: AgentLiveConfig[],
  changes: PendingChange[]
): AgentLiveConfig[] {
  const result: AgentLiveConfig[] = configs.map((config) => ({
    ...config,
    mcpServers: { ...config.mcpServers },
    remoteMcpServers: { ...config.remoteMcpServers },
    skills: [...config.skills],
  }));

  for (const change of changes) {
    const config = result.find((entry) => entry.agent === change.agent);
    if (!config) continue;

    if (change.category === 'mcp') {
      if (change.type === 'add' && change.entry) {
        config.mcpServers[change.key] = change.entry;
        delete config.remoteMcpServers[change.key];
      } else if (change.type === 'add' && change.remoteEntry) {
        config.remoteMcpServers[change.key] = change.remoteEntry;
        delete config.mcpServers[change.key];
      } else if (change.type === 'remove') {
        delete config.mcpServers[change.key];
        delete config.remoteMcpServers[change.key];
      }
      continue;
    }

    if (change.category === 'skill') {
      if (change.type === 'add' && change.skillEntry) {
        if (!config.skills.some((skill) => skill.name === change.key)) {
          config.skills = [...config.skills, change.skillEntry];
        }
      } else if (change.type === 'remove') {
        config.skills = config.skills.filter((skill) => skill.name !== change.key);
      }
      continue;
    }

    if (change.type === 'add' && change.pluginEntry) {
      if (!config.skills.some((skill) => skill.name === change.key && skill.kind === 'plugin')) {
        config.skills = [...config.skills, change.pluginEntry];
      }
    } else if (change.type === 'remove') {
      config.skills = config.skills.filter(
        (skill) => !(skill.name === change.key && skill.kind === 'plugin')
      );
    }
  }

  return result;
}

function getPendingKeys(changes: PendingChange[]): PendingKeyMaps {
  const added = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();
  const skillAdded = new Map<string, Set<string>>();
  const skillRemoved = new Map<string, Set<string>>();
  const pluginAdded = new Map<string, Set<string>>();
  const pluginRemoved = new Map<string, Set<string>>();

  for (const change of changes) {
    if (change.category === 'plugin') {
      const map = change.type === 'add' ? pluginAdded : pluginRemoved;
      if (!map.has(change.agent)) map.set(change.agent, new Set());
      map.get(change.agent)?.add(change.key);
      continue;
    }

    const isSkill = change.category === 'skill';
    const map =
      change.type === 'add'
        ? isSkill
          ? skillAdded
          : added
        : isSkill
          ? skillRemoved
          : removed;

    if (!map.has(change.agent)) map.set(change.agent, new Set());
    map.get(change.agent)?.add(change.key);
  }

  return { added, removed, skillAdded, skillRemoved, pluginAdded, pluginRemoved };
}

export function buildChangeSummaryLines(changes: PendingChange[]): string[] {
  return changes.map((change) => {
    if (change.category === 'plugin') {
      return change.type === 'add'
        ? `+ [Plugin] ${change.key} → ${AGENT_LABELS[change.agent] ?? change.agent}`
        : `- [Plugin] ${change.key} from ${AGENT_LABELS[change.agent] ?? change.agent}`;
    }

    const prefix = change.category === 'skill' ? '[Skill] ' : '[MCP] ';

    return change.type === 'add'
      ? `+ ${prefix}${change.key} → ${AGENT_LABELS[change.agent] ?? change.agent}`
      : `- ${prefix}${change.key} from ${AGENT_LABELS[change.agent] ?? change.agent}`;
  });
}

export function buildOverlayData(
  previewConfigs: AgentLiveConfig[],
  activeId: string | null
): OverlayData | null {
  if (!activeId) return null;

  const parsed = parseDragId(activeId);
  if (!parsed) return null;

  const config = previewConfigs.find((entry) => entry.agent === parsed.agent);
  if (!config) return null;

  if (parsed.category === 'mcp') {
    const entry = config.mcpServers[parsed.key];
    if (entry) {
      const sublabel =
        entry.args && entry.args.length > 0 ? `${entry.command} ${entry.args.join(' ')}` : entry.command;
      return { label: parsed.key, sublabel };
    }

    const remoteEntry = config.remoteMcpServers[parsed.key];
    if (remoteEntry) {
      return {
        label: parsed.key,
        sublabel: `[remote] ${remoteEntry.transport.toUpperCase()} ${remoteEntry.url}`,
      };
    }

    return null;
  }

  if (parsed.category === 'skill') {
    const skill = config.skills.find((entry) => entry.name === parsed.key);
    if (!skill) return null;
    return { label: skill.name, sublabel: skill.source ?? 'local' };
  }

  const plugin = config.skills.find(
    (entry) => entry.kind === 'plugin' && entry.name === parsed.key
  );
  if (!plugin) return null;

  return { label: plugin.name, sublabel: formatPluginSubtitle(plugin) };
}

export function finalizeResolvedPendingAddition({
  startedPreflightGeneration,
  currentPreflightGeneration,
  isEditMode,
  agentConfigs,
  pendingChanges,
  nextChange,
}: FinalizeResolvedPendingAdditionOptions): FinalizeResolvedPendingAdditionResult {
  if (!isEditMode || startedPreflightGeneration !== currentPreflightGeneration) {
    return {
      changes: pendingChanges,
      didStage: false,
      error: null,
      reason: 'stale',
    };
  }

  const alreadyStaged = pendingChanges.some(
    (change) =>
      change.type === 'add' &&
      change.category === nextChange.category &&
      change.agent === nextChange.agent &&
      change.key === nextChange.key
  );
  if (alreadyStaged) {
    return {
      changes: pendingChanges,
      didStage: false,
      error: null,
      reason: 'duplicate',
    };
  }

  const latestPreviewConfigs = applyPendingChanges(agentConfigs, pendingChanges);
  const stagingError = canStagePendingAddition(latestPreviewConfigs, nextChange);
  if (stagingError) {
    return {
      changes: pendingChanges,
      didStage: false,
      error: stagingError,
      reason: 'conflict',
    };
  }

  return {
    changes: [...pendingChanges, nextChange],
    didStage: true,
    error: null,
    reason: 'staged',
  };
}

export function useProfilesBoard() {
  const [agentConfigs, setAgentConfigs] = useState<AgentLiveConfig[]>([]);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success'>('idle');
  const agentConfigsRef = useRef(agentConfigs);
  const pendingChangesRef = useRef(pendingChanges);
  const isEditModeRef = useRef(isEditMode);
  const preflightGenerationRef = useRef(0);

  agentConfigsRef.current = agentConfigs;
  pendingChangesRef.current = pendingChanges;
  isEditModeRef.current = isEditMode;

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (type === 'success') {
      toast.success(message);
    } else {
      toast.error(message);
    }
  }, []);

  const invalidatePendingPreflights = useCallback(() => {
    preflightGenerationRef.current += 1;
  }, []);

  const fetchLiveConfigs = useCallback(async (options?: { suppressErrorToast?: boolean }) => {
    try {
      const configs = await fetchJson<AgentLiveConfig[]>('/api/agents/live');
      setAgentConfigs(configs);
      return configs;
    } catch (error) {
      if (!options?.suppressErrorToast) {
        showFeedback('error', `Failed to load agent configs: ${(error as Error).message}`);
      }
      throw error;
    }
  }, [showFeedback]);

  const handleRefresh = useCallback(async () => {
    if (refreshState === 'loading') return;

    setRefreshState('loading');
    const startedAt = Date.now();
    invalidatePendingPreflights();

    try {
      await fetchLiveConfigs();
      const elapsed = Date.now() - startedAt;
      if (elapsed < 400) {
        await new Promise((resolve) => setTimeout(resolve, 400 - elapsed));
      }
      setPendingChanges([]);
      setRefreshState('success');
      toast.success('Agent configs refreshed');
      setTimeout(() => {
        setRefreshState((current) => (current === 'success' ? 'idle' : current));
      }, 1200);
    } catch {
      setRefreshState('idle');
    }
  }, [fetchLiveConfigs, invalidatePendingPreflights, refreshState]);

  useEffect(() => {
    void (async () => {
      try {
        await fetchLiveConfigs();
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchLiveConfigs]);

  const previewConfigs = useMemo(
    () => applyPendingChanges(agentConfigs, pendingChanges),
    [agentConfigs, pendingChanges]
  );
  const pendingKeyMaps = useMemo(() => getPendingKeys(pendingChanges), [pendingChanges]);
  const changeSummaryLines = useMemo(
    () => buildChangeSummaryLines(pendingChanges),
    [pendingChanges]
  );
  const overlayData = useMemo(
    () => buildOverlayData(previewConfigs, activeId),
    [previewConfigs, activeId]
  );
  const liveAgentCount = useMemo(
    () => previewConfigs.filter((config) => config.exists).length,
    [previewConfigs]
  );
  const totalPortableItems = useMemo(
    () =>
      previewConfigs.reduce(
        (sum, config) =>
          sum +
          Object.keys(config.mcpServers).length +
          Object.keys(config.remoteMcpServers).length +
          splitAgentSkillEntries(config.skills).skills.length +
          splitAgentSkillEntries(config.skills).plugins.length,
        0
      ),
    [previewConfigs]
  );

  const handleStagedRemove = useCallback(
    (agent: string, category: 'mcp' | 'skill' | 'plugin', key: string) => {
      setPendingChanges((previous) => {
        const alreadyStaged = previous.some(
          (change) => change.agent === agent && change.category === category && change.key === key
        );
        if (alreadyStaged) return previous;

        return [
          ...previous,
          { id: nextChangeId(), type: 'remove', category, agent, key },
        ];
      });
    },
    []
  );

  const handleUndoChange = useCallback((id: string) => {
    setPendingChanges((previous) => previous.filter((change) => change.id !== id));
  }, []);

  const handleDiscardAll = useCallback(() => {
    invalidatePendingPreflights();
    setPendingChanges([]);
  }, [invalidatePendingPreflights]);

  const handleSave = useCallback(() => {
    setConfirmOpen((current) => {
      if (pendingChanges.length === 0) return current;
      return true;
    });
  }, [pendingChanges.length]);

  const handleConfirmSave = useCallback(async () => {
    setConfirmOpen(false);
    const changeCount = pendingChanges.length;

    invalidatePendingPreflights();
    setSaving(true);
    try {
      const result = await applyPendingChangesWithApi(pendingChanges, async (change) => {
        if (change.category === 'mcp') {
          if (change.type === 'add' && (change.entry || change.remoteEntry)) {
            await fetchJson(`/api/agents/${change.agent}/mcps`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: change.key,
                entry: change.entry,
                remoteEntry: change.remoteEntry,
              }),
            });
            return;
          }

          if (change.type === 'remove') {
            await fetchJson(`/api/agents/${change.agent}/mcps/${encodeURIComponent(change.key)}`, {
              method: 'DELETE',
            });
            return;
          }

          throw new Error(
            `MCP "${change.key}" is missing the staged metadata needed to apply this change.`
          );
        }

        if (change.category === 'skill') {
          if (change.type === 'add' && change.sourceAgent) {
            await fetchJson(`/api/agents/${change.agent}/skills`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: change.key,
                sourceAgent: change.sourceAgent,
                source: change.skillEntry?.source,
              }),
            });
            return;
          }

          if (change.type === 'remove') {
            await fetchJson(`/api/agents/${change.agent}/skills/${encodeURIComponent(change.key)}`, {
              method: 'DELETE',
            });
            return;
          }

          throw new Error(
            `Skill "${change.key}" is missing the staged metadata needed to apply this change.`
          );
        }

        if (change.type === 'add' && change.sourceAgent) {
          await fetchJson(`/api/agents/${change.agent}/plugins`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: change.key,
              sourceAgent: change.sourceAgent,
            }),
          });
          return;
        }

        if (change.type === 'remove') {
          await fetchJson(`/api/agents/${change.agent}/plugins/${encodeURIComponent(change.key)}`, {
            method: 'DELETE',
          });
          return;
        }

        throw new Error(
          `Plugin "${change.key}" is missing the staged metadata needed to apply this change.`
        );
      });

      setAgentConfigs((previous) => applyPendingChanges(previous, result.applied));
      setPendingChanges(result.failed.map((failure) => failure.change));

      let reloadError: Error | null = null;
      try {
        await fetchLiveConfigs({ suppressErrorToast: true });
      } catch (error) {
        reloadError = error as Error;
      }

      if (result.failed.length > 0) {
        showFeedback(
          'error',
          `Applied ${result.applied.length}/${changeCount}. ${result.failed[0]?.error} ${result.failed.length} change${result.failed.length > 1 ? 's remain' : ' remains'} staged.${reloadError ? ` Live reload failed: ${reloadError.message}` : ''}`
        );
      } else {
        setIsEditMode(false);
        const affectedAgents = Array.from(new Set(result.applied.map((change) => change.agent))).map(
          (agent) => AGENT_LABELS[agent] ?? agent
        );
        const agentList =
          affectedAgents.length <= 1
            ? affectedAgents[0]
            : affectedAgents.length === 2
              ? `${affectedAgents[0]} & ${affectedAgents[1]}`
              : `${affectedAgents.slice(0, -1).join(', ')} & ${affectedAgents[affectedAgents.length - 1]}`;
        const restartMessage = agentList
          ? `Restart ${agentList} to pick up the changes.`
          : undefined;
        const description = reloadError
          ? `${restartMessage ? `${restartMessage} ` : ''}Live reload failed: ${reloadError.message}`
          : restartMessage;

        toast.success(`Applied ${result.applied.length} change${result.applied.length > 1 ? 's' : ''}`, {
          description,
          duration: 8000,
        });
      }
    } finally {
      setSaving(false);
    }
  }, [fetchLiveConfigs, invalidatePendingPreflights, pendingChanges, showFeedback]);

  const stageValidatedChange = useCallback(
    (startedPreflightGeneration: number, nextChange: PendingChange) => {
      const initialResult = finalizeResolvedPendingAddition({
        startedPreflightGeneration,
        currentPreflightGeneration: preflightGenerationRef.current,
        isEditMode: isEditModeRef.current,
        agentConfigs: agentConfigsRef.current,
        pendingChanges: pendingChangesRef.current,
        nextChange,
      });
      if (initialResult.error) {
        showFeedback('error', initialResult.error);
        return;
      }
      if (!initialResult.didStage) {
        return;
      }

      setPendingChanges((previous) =>
        finalizeResolvedPendingAddition({
          startedPreflightGeneration,
          currentPreflightGeneration: preflightGenerationRef.current,
          isEditMode: isEditModeRef.current,
          agentConfigs: agentConfigsRef.current,
          pendingChanges: previous,
          nextChange,
        }).changes
      );
    },
    [showFeedback]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!isEditMode) return;
      setActiveId(event.active.id as string);
    },
    [isEditMode]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      if (!isEditMode) return;

      const { active, over } = event;
      if (!over) return;

      const source = parseDragId(active.id as string);
      const target = parseDropId(over.id as string);
      if (!source || !target) return;
      if (source.agent === target.agent) return;

      const sourceConfig = previewConfigs.find((config) => config.agent === source.agent);
      if (!sourceConfig) return;

      if (source.category === 'mcp') {
        const entry = sourceConfig.mcpServers[source.key];
        const remoteEntry = sourceConfig.remoteMcpServers[source.key];
        if (!entry && !remoteEntry) return;

        const alreadyStaged = pendingChanges.some(
          (change) =>
            change.type === 'add' &&
            change.category === 'mcp' &&
            change.agent === target.agent &&
            change.key === source.key
        );
        if (alreadyStaged) return;

        const nextChange: PendingChange = {
          id: nextChangeId(),
          type: 'add',
          category: 'mcp',
          agent: target.agent,
          key: source.key,
          entry,
          remoteEntry,
          sourceAgent: source.agent,
        };
        const stagingError = canStagePendingAddition(previewConfigs, nextChange);
        if (stagingError) {
          showFeedback('error', stagingError);
          return;
        }

        const startedPreflightGeneration = preflightGenerationRef.current;
        void (async () => {
          try {
            const preflight = await fetchJson<McpPreflightResult>(
              `/api/agents/${target.agent}/mcps/check`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: source.key, entry, remoteEntry }),
              }
            );

            const firstError = preflight.checks.find((check) => check.status === 'error');
            if (firstError) {
              showFeedback('error', firstError.message);
              return;
            }

            stageValidatedChange(startedPreflightGeneration, nextChange);
          } catch (error) {
            showFeedback(
              'error',
              `Failed to validate MCP "${source.key}" before staging: ${(error as Error).message}`
            );
          }
        })();
        return;
      }

      if (source.category === 'skill') {
        const skill = sourceConfig.skills.find((entry) => entry.name === source.key);
        if (!skill) return;

        const alreadyStaged = pendingChanges.some(
          (change) =>
            change.type === 'add' &&
            change.category === 'skill' &&
            change.agent === target.agent &&
            change.key === source.key
        );
        if (alreadyStaged) return;

        const nextChange: PendingChange = {
          id: nextChangeId(),
          type: 'add',
          category: 'skill',
          agent: target.agent,
          key: source.key,
          skillEntry: skill,
          sourceAgent: source.agent,
        };
        const stagingError = canStagePendingAddition(previewConfigs, nextChange);
        if (stagingError) {
          showFeedback('error', stagingError);
          return;
        }

        const startedPreflightGeneration = preflightGenerationRef.current;
        void (async () => {
          try {
            const preflight = await fetchJson<SkillPreflightResult>(
              `/api/agents/${target.agent}/skills/check`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: source.key,
                  sourceAgent: source.agent,
                  source: skill.source,
                }),
              }
            );

            const firstError = preflight.checks.find((check) => check.status === 'error');
            if (firstError) {
              showFeedback('error', firstError.message);
              return;
            }

            stageValidatedChange(startedPreflightGeneration, nextChange);
          } catch (error) {
            showFeedback(
              'error',
              `Failed to validate skill "${source.key}" before staging: ${(error as Error).message}`
            );
          }
        })();
        return;
      }

      const plugin = sourceConfig.skills.find(
        (entry) => entry.name === source.key && entry.kind === 'plugin'
      );
      if (!plugin) return;

      const alreadyStaged = pendingChanges.some(
        (change) =>
          change.type === 'add' &&
          change.category === 'plugin' &&
          change.agent === target.agent &&
          change.key === source.key
      );
      if (alreadyStaged) return;

      const nextChange: PendingChange = {
        id: nextChangeId(),
        type: 'add',
        category: 'plugin',
        agent: target.agent,
        key: source.key,
        pluginEntry: plugin,
        sourceAgent: source.agent,
      };
      const stagingError = canStagePendingAddition(previewConfigs, nextChange);
      if (stagingError) {
        showFeedback('error', stagingError);
        return;
      }

      const startedPreflightGeneration = preflightGenerationRef.current;
      void (async () => {
        try {
          const preflight = await fetchJson<{
            ok: boolean;
            checks: Array<{ label: string; status: 'ok' | 'warn' | 'error'; message: string }>;
          }>(`/api/agents/${target.agent}/plugins/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: source.key,
              sourceAgent: source.agent,
            }),
          });

          const firstError = preflight.checks.find((check) => check.status === 'error');
          if (firstError) {
            showFeedback('error', firstError.message);
            return;
          }

          stageValidatedChange(startedPreflightGeneration, nextChange);
        } catch (error) {
          showFeedback(
            'error',
            `Failed to validate plugin "${source.key}" before staging: ${(error as Error).message}`
          );
        }
      })();
    },
    [isEditMode, pendingChanges, previewConfigs, showFeedback, stageValidatedChange]
  );

  useEffect(() => {
    if (!isEditMode) {
      setActiveId(null);
    }
  }, [isEditMode]);

  return {
    pendingChanges,
    loading,
    saving,
    confirmOpen,
    refreshState,
    isEditMode,
    previewConfigs,
    pendingAddedMap: pendingKeyMaps.added,
    pendingRemovedMap: pendingKeyMaps.removed,
    pendingSkillAddedMap: pendingKeyMaps.skillAdded,
    pendingSkillRemovedMap: pendingKeyMaps.skillRemoved,
    pendingPluginAddedMap: pendingKeyMaps.pluginAdded,
    pendingPluginRemovedMap: pendingKeyMaps.pluginRemoved,
    changeSummaryLines,
    liveAgentCount,
    totalPortableItems,
    fetchLiveConfigs,
    handleRefresh,
    handleStagedRemove,
    handleUndoChange,
    handleDiscardAll,
    handleSave,
    handleConfirmSave,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
    overlayData,
    setConfirmOpen,
    setIsEditMode,
  };
}
