import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import {
  ArrowRightLeft,
  Boxes,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  PencilLine,
  RefreshCw,
  Save,
} from 'lucide-react';
import { useState } from 'react';

import ConfirmDialog from '../components/ConfirmDialog.js';
import { AgentColumn } from './board/AgentColumn.js';
import { ConfirmSwitchProjectModal } from './board/ConfirmSwitchProjectModal.js';
import { DragOverlayCard, snapToPointer } from './board/DragOverlayCard.js';
import { DropTray } from './board/DropTray.js';
import { PendingChangesBar } from './board/PendingChangesBar.js';
import { ProjectBar } from './board/ProjectBar.js';
import { customCollisionDetection } from './board/dnd.js';
import { useProfilesBoard } from './board/useProfilesBoard.js';

export default function ProfilesView() {
  const {
    loading,
    saving,
    confirmOpen,
    refreshState,
    isEditMode,
    previewConfigs,
    boardScope,
    setBoardScope,
    activeProject,
    setActiveProject,
    pendingChanges,
    pendingAddedMap,
    pendingRemovedMap,
    pendingProjectAddedMap,
    pendingProjectRemovedMap,
    pendingSkillAddedMap,
    pendingSkillRemovedMap,
    pendingPluginAddedMap,
    pendingPluginRemovedMap,
    changeSummaryLines,
    liveAgentCount,
    totalPortableItems,
    handleRefresh,
    handleStagedRemove,
    handleMoveMcpScope,
    moveScopeRequest,
    cancelMoveScope,
    confirmMoveScope,
    dropConflict,
    resolveDropConflict,
    dismissDropConflict,
    handleUndoChange,
    handleDiscardAll,
    handleSave,
    handleConfirmSave,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
    overlayData,
    activeId,
    setConfirmOpen,
    setIsEditMode,
  } = useProfilesBoard();

  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<string | null>(null);

  const requestSwitch = (target: string) => {
    if (target === activeProject) return;
    if (pendingChanges.length > 0) {
      setPendingSwitchTarget(target);
    } else {
      setActiveProject(target);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  if (loading) {
    return (
      <div className="grid gap-4 w-full">
        <div className="flex items-center gap-3 py-8 text-zinc-500 font-medium">
          <Loader2 size={20} className="animate-spin text-zinc-400" /> Loading agent configs...
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 w-full">
      <div className="flex flex-col items-stretch gap-4 pb-4 border-b border-zinc-200/60 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-w-0 flex-nowrap items-center gap-3">
            <h3 className="m-0 shrink-0 text-xl font-semibold tracking-tight text-zinc-900">Local agents</h3>
            <ProjectBar
              scope={boardScope}
              onScopeChange={setBoardScope}
              activeProject={activeProject}
              onActiveProjectChange={requestSwitch}
            />
          </div>
          <span className="text-[13px] font-medium text-zinc-500">
            Drag skills, MCPs, and plugins across columns.
          </span>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm">
            <ArrowRightLeft size={12} className="text-zinc-400" /> {liveAgentCount} agents
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm">
            <Boxes size={12} className="text-zinc-400" /> {totalPortableItems} items
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm">
            <Save size={12} className="text-zinc-400" /> {pendingChanges.length} staged
          </span>
          <button
            className={`inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-all disabled:opacity-50 ${isEditMode ? 'bg-zinc-900 text-white shadow-sm' : 'border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}`}
            type="button"
            onClick={() => setIsEditMode((value) => !value)}
            disabled={saving}
          >
            {isEditMode ? <Check size={14} /> : <PencilLine size={14} />}
            {isEditMode ? 'Done editing' : 'Edit items'}
          </button>
          <div className="inline-flex h-[26px] items-stretch gap-0.5 rounded-lg border border-zinc-200 bg-white px-0.5 shadow-sm">
            <div className="relative group flex items-stretch">
              <button
                className="inline-flex h-full w-7 items-center justify-center rounded text-zinc-700 transition-all hover:bg-zinc-100"
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('brainctl:zones-expand'))}
                aria-label="Expand all sections"
              >
                <ChevronsUpDown size={14} className="text-zinc-500" />
              </button>
              <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                Expand all
              </span>
            </div>
            <div className="relative group flex items-stretch">
              <button
                className="inline-flex h-full w-7 items-center justify-center rounded text-zinc-700 transition-all hover:bg-zinc-100"
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('brainctl:zones-collapse'))}
                aria-label="Collapse all sections"
              >
                <ChevronsDownUp size={14} className="text-zinc-500" />
              </button>
              <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                Collapse all
              </span>
            </div>
            <div className="relative group flex items-stretch">
              <button
                className={[
                  'inline-flex h-full w-7 items-center justify-center rounded transition-all duration-200 disabled:opacity-50',
                  refreshState === 'success'
                    ? 'bg-emerald-50 text-emerald-700'
                    : refreshState === 'loading'
                      ? 'bg-zinc-100 text-zinc-700'
                      : 'text-zinc-700 hover:bg-zinc-100',
                ].join(' ')}
                onClick={() => void handleRefresh()}
                disabled={saving || refreshState === 'loading'}
                aria-label="Refresh"
              >
                {refreshState === 'loading' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : refreshState === 'success' ? (
                  <Check size={14} className="animate-[ping_400ms_ease-out_1]" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
              <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                {refreshState === 'loading'
                  ? 'Refreshing'
                  : refreshState === 'success'
                    ? 'Up to date'
                    : 'Refresh'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <PendingChangesBar
        changes={pendingChanges}
        onUndoChange={handleUndoChange}
        onDiscardAll={handleDiscardAll}
        onSave={handleSave}
        saving={saving}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        autoScroll={false}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 items-start lg:grid-cols-3 w-full">
          {previewConfigs.map((config, index) => (
            <div
              key={config.agent}
              className={`py-10 lg:py-0 lg:px-6 ${index !== 0 ? 'border-t border-zinc-200 lg:border-t-0 lg:border-l' : ''} ${index === 0 ? 'pt-0' : ''} ${index === previewConfigs.length - 1 ? 'pb-0' : ''}`}
            >
              <AgentColumn
                config={config}
                scope={boardScope}
                pendingAdded={pendingAddedMap.get(config.agent) ?? new Set()}
                pendingRemoved={pendingRemovedMap.get(config.agent) ?? new Set()}
                pendingProjectAdded={pendingProjectAddedMap.get(config.agent) ?? new Set()}
                pendingProjectRemoved={pendingProjectRemovedMap.get(config.agent) ?? new Set()}
                pendingSkillAdded={pendingSkillAddedMap.get(config.agent) ?? new Set()}
                pendingSkillRemoved={pendingSkillRemovedMap.get(config.agent) ?? new Set()}
                pendingPluginAdded={pendingPluginAddedMap.get(config.agent) ?? new Set()}
                pendingPluginRemoved={pendingPluginRemovedMap.get(config.agent) ?? new Set()}
                onStagedRemove={handleStagedRemove}
                onMoveMcpScope={handleMoveMcpScope}
                moveScopeRequest={moveScopeRequest}
                activeProjectPath={activeProject}
                onConfirmMoveScope={confirmMoveScope}
                onCancelMoveScope={cancelMoveScope}
                editable={isEditMode}
              />
            </div>
          ))}
        </div>

        <DragOverlay modifiers={[snapToPointer]}>
          {overlayData ? (
            <DragOverlayCard label={overlayData.label} sublabel={overlayData.sublabel} />
          ) : null}
        </DragOverlay>

        <DropTray activeId={activeId} configs={previewConfigs} />
      </DndContext>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Apply ${pendingChanges.length} change${pendingChanges.length > 1 ? 's' : ''}?`}
        description="The following changes will be written to agent config files:"
        confirmLabel="Apply changes"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => void handleConfirmSave()}
      >
        <div className="scrollbar-none mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 max-h-64 overflow-y-auto">
          <ul className="space-y-2 font-mono text-xs font-medium text-zinc-700">
            {changeSummaryLines.map((line, index) => (
              <li
                key={index}
                className={line.startsWith('+') ? 'text-zinc-900' : 'text-zinc-500 line-through'}
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>

      <AlertDialog.Root
        open={Boolean(dropConflict)}
        onOpenChange={(open) => {
          if (!open) dismissDropConflict();
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-semibold tracking-tight text-zinc-900">
              {dropConflict?.categoryLabel ?? 'Item'} already exists
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-zinc-500">
              {dropConflict
                ? `${dropConflict.targetLabel} already has "${dropConflict.change.key}". Choose how to handle this copy.`
                : ''}
            </AlertDialog.Description>
            {dropConflict && (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs font-medium text-zinc-600">
                {dropConflict.canKeepBoth ? (
                  <>
                    Keep both will stage the copied item as <span className="font-mono text-zinc-900">{dropConflict.suggestedKey}</span>.
                  </>
                ) : (
                  'Plugin bundles cannot be duplicated safely because their bundled skills and MCPs keep their original names.'
                )}
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
                  onClick={() => resolveDropConflict('keep-current')}
                >
                  Keep current
                </button>
              </AlertDialog.Cancel>
              {dropConflict?.canKeepBoth && (
                <AlertDialog.Action asChild>
                  <button
                    type="button"
                    className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
                    onClick={() => resolveDropConflict('keep-both')}
                  >
                    Keep both
                  </button>
                </AlertDialog.Action>
              )}
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800"
                  onClick={() => resolveDropConflict('replace')}
                >
                  Replace
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {pendingSwitchTarget && (
        <ConfirmSwitchProjectModal
          pendingCount={pendingChanges.length}
          targetProject={pendingSwitchTarget}
          onCancel={() => setPendingSwitchTarget(null)}
          onDiscardAndSwitch={() => {
            handleDiscardAll();
            setActiveProject(pendingSwitchTarget);
            setPendingSwitchTarget(null);
          }}
          onSaveAndSwitch={async () => {
            await handleConfirmSave();
            setActiveProject(pendingSwitchTarget);
            setPendingSwitchTarget(null);
          }}
        />
      )}
    </div>
  );
}
