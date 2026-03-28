import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Plus, Save, Trash2 } from 'lucide-react';

import {
  addMcpDraft,
  areMcpDraftsDirty,
  buildMcpSavePayload,
  createMcpDraftsFromConfig,
  removeMcpDraft,
  updateMcpDraft,
  type McpDraft
} from './config-editor';

interface McpViewProps {
  mcps: Record<string, unknown>;
  onSave: (mcps: Record<string, unknown>) => Promise<void>;
  onStateChange?: (state: { isDirty: boolean; isSaving: boolean }) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function McpView({ mcps, onSave, onStateChange }: McpViewProps) {
  const [drafts, setDrafts] = useState<McpDraft[]>(() => createMcpDraftsFromConfig(mcps));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const isSaving = saveState === 'saving';

  useEffect(() => {
    if (isSaving) {
      return;
    }

    setDrafts(createMcpDraftsFromConfig(mcps));
  }, [isSaving, mcps]);

  const isDirty = areMcpDraftsDirty(drafts, mcps);

  useEffect(() => {
    onStateChange?.({ isDirty, isSaving });
  }, [isDirty, isSaving, onStateChange]);

  function resetSaveMessage(): void {
    if (isSaving) {
      return;
    }

    if (saveState !== 'idle' || message) {
      setSaveState('idle');
      setMessage(null);
    }
  }

  async function handleSave(): Promise<void> {
    if (isSaving) {
      return;
    }

    try {
      setSaveState('saving');
      setMessage(null);

      const payload = buildMcpSavePayload(drafts);
      await onSave(payload);

      setSaveState('saved');
      setMessage('Saved MCP config and refreshed the dashboard state.');
    } catch (error) {
      setSaveState('error');
      setMessage(error instanceof Error ? error.message : 'Failed to save MCP config.');
    }
  }

  return (
    <div className="view-stack config-view">
      <section className="panel-inner config-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">MCP</p>
            <h3>Config-only entries</h3>
          </div>
          <span className="muted-pill">{drafts.length} configured</span>
        </div>

        <p className="muted-copy">
          These entries are stored in `ai-stack.yaml` today. The dashboard exposes the raw JSON
          payload, but MCP runtime integration is not wired up in this shell yet.
        </p>

        <div className="config-toolbar">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              resetSaveMessage();
              setDrafts((current) => addMcpDraft(current));
            }}
            disabled={isSaving}
          >
            <Plus size={16} />
            Add MCP entry
          </button>

          <button
            type="button"
            className="run-button"
            onClick={() => void handleSave()}
            disabled={isSaving || !isDirty}
          >
            <Save size={16} />
            {isSaving ? 'Saving…' : 'Save MCP config'}
          </button>
        </div>

        {drafts.length === 0 ? (
          <div className="config-empty-state">
            <strong>No MCP entries configured</strong>
            <p>Add an entry to persist JSON config into `ai-stack.yaml`.</p>
          </div>
        ) : (
          <div className="config-list">
            {drafts.map((draft, index) => (
              <article key={draft.id} className="config-card">
                <div className="config-card-header">
                  <div>
                    <p className="eyebrow">Entry {index + 1}</p>
                    <h4>{draft.name.trim() || 'Untitled MCP entry'}</h4>
                  </div>

                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      resetSaveMessage();
                      setDrafts((current) => removeMcpDraft(current, index));
                    }}
                    disabled={isSaving}
                  >
                    <Trash2 size={16} />
                    Remove
                  </button>
                </div>

                <label className="field">
                  <span className="field-label">Entry key</span>
                  <input
                    className="field-control"
                    value={draft.name}
                    onChange={(event) => {
                      resetSaveMessage();
                      setDrafts((current) =>
                        updateMcpDraft(current, index, { name: event.target.value })
                      );
                    }}
                    placeholder="github"
                    spellCheck={false}
                    disabled={isSaving}
                  />
                </label>

                <label className="field">
                  <span className="field-label">JSON payload</span>
                  <textarea
                    className="field-control editor-textarea editor-code"
                    value={draft.json}
                    onChange={(event) => {
                      resetSaveMessage();
                      setDrafts((current) =>
                        updateMcpDraft(current, index, { json: event.target.value })
                      );
                    }}
                    placeholder='{\n  "command": "npx"\n}'
                    spellCheck={false}
                    disabled={isSaving}
                  />
                  <span className="field-help">Parsed and validated only when you click save.</span>
                </label>
              </article>
            ))}
          </div>
        )}

        {message ? (
          <SaveFeedback
            state={saveState}
            message={message}
          />
        ) : null}
      </section>
    </div>
  );
}

function SaveFeedback({ state, message }: { state: SaveState; message: string }) {
  return (
    <div className={`save-feedback ${state}`} aria-live="polite">
      {state === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
      <span>{message}</span>
    </div>
  );
}
