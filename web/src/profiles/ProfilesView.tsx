import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
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
      <ProjectBar
        scope={boardScope}
        onScopeChange={setBoardScope}
        activeProject={activeProject}
        onActiveProjectChange={requestSwitch}
      />
      <div className="flex flex-col items-stretch gap-4 pb-4 border-b border-zinc-200/60 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-1">
          <h3 className="text-xl font-semibold tracking-tight text-zinc-900 m-0">Local agents</h3>
          <span className="text-[13px] font-medium text-zinc-500">
            Drag skills, MCPs, and plugins across columns.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[12px] font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('brainctl:zones-expand'))}
            title="Expand all sections"
          >
            <ChevronsUpDown size={12} className="text-zinc-500" /> Expand all
          </button>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[12px] font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('brainctl:zones-collapse'))}
            title="Collapse all sections"
          >
            <ChevronsDownUp size={12} className="text-zinc-500" /> Collapse all
          </button>
          <button
            className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-all disabled:opacity-50 ${isEditMode ? 'bg-zinc-900 text-white shadow-sm' : 'border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}`}
            type="button"
            onClick={() => setIsEditMode((value) => !value)}
            disabled={saving}
          >
            {isEditMode ? <Check size={14} /> : <PencilLine size={14} />}
            {isEditMode ? 'Done editing' : 'Edit items'}
          </button>
          <button
            className={[
              'inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium shadow-sm transition-all duration-200 disabled:opacity-50',
              refreshState === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : refreshState === 'loading'
                  ? 'border-zinc-300 bg-zinc-100 text-zinc-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
            onClick={() => void handleRefresh()}
            disabled={saving || refreshState === 'loading'}
          >
            {refreshState === 'loading' ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Refreshing
              </>
            ) : refreshState === 'success' ? (
              <>
                <Check size={12} className="animate-[ping_400ms_ease-out_1]" /> Up to date
              </>
            ) : (
              <>
                <RefreshCw size={12} /> Refresh
              </>
            )}
          </button>
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
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 max-h-64 overflow-y-auto">
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
