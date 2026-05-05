export interface ConfirmSwitchProjectModalProps {
  pendingCount: number;
  targetProject: string;
  onSaveAndSwitch: () => void;
  onDiscardAndSwitch: () => void;
  onCancel: () => void;
}

export function ConfirmSwitchProjectModal(p: ConfirmSwitchProjectModalProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-md bg-white p-4 shadow-xl">
        <h3 className="text-sm font-semibold text-zinc-900">Unsaved changes</h3>
        <p className="mt-2 text-sm text-zinc-600">
          You have {p.pendingCount} unsaved change{p.pendingCount === 1 ? '' : 's'}. What would you
          like to do before switching to <span className="font-mono">{p.targetProject}</span>?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1 text-sm text-zinc-600" onClick={p.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm"
            onClick={p.onDiscardAndSwitch}
          >
            Discard &amp; switch
          </button>
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white"
            onClick={p.onSaveAndSwitch}
          >
            Save &amp; switch
          </button>
        </div>
      </div>
    </div>
  );
}
