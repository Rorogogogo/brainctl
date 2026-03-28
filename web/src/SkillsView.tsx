import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Plus, Save, Trash2 } from 'lucide-react';

import {
  addSkillDraft,
  areSkillDraftsDirty,
  buildSkillSavePayload,
  createSkillDraftsFromConfig,
  removeSkillDraft,
  updateSkillDraft,
  type SkillDraft,
  type SkillSavePayloadEntry
} from './config-editor';

interface SkillsViewProps {
  skills: Record<string, SkillSavePayloadEntry>;
  onSave: (skills: Record<string, SkillSavePayloadEntry>) => Promise<void>;
  onStateChange?: (state: { isDirty: boolean; isSaving: boolean }) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function SkillsView({ skills, onSave, onStateChange }: SkillsViewProps) {
  const [drafts, setDrafts] = useState<SkillDraft[]>(() => toSkillDrafts(skills));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const isSaving = saveState === 'saving';

  useEffect(() => {
    if (isSaving) {
      return;
    }

    setDrafts(toSkillDrafts(skills));
  }, [isSaving, skills]);

  const isDirty = areSkillDraftsDirty(drafts, skills);
  const removeDisabled = drafts.length <= 1;

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

      const payload = buildSkillSavePayload(drafts);
      await onSave(payload);

      setSaveState('saved');
      setMessage('Saved skills and refreshed the dashboard state.');
    } catch (error) {
      setSaveState('error');
      setMessage(error instanceof Error ? error.message : 'Failed to save skills.');
    }
  }

  return (
    <div className="view-stack config-view">
      <section className="panel-inner config-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Skills</p>
            <h3>Structured prompt library</h3>
          </div>
          <span className="muted-pill">{drafts.length} configured</span>
        </div>

        <p className="muted-copy">
          Edit the skill name, description, and prompt body that feed `brainctl run`.
        </p>

        <div className="config-toolbar">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              resetSaveMessage();
              setDrafts((current) => addSkillDraft(current));
            }}
            disabled={isSaving}
          >
            <Plus size={16} />
            Add skill
          </button>

          <button
            type="button"
            className="run-button"
            onClick={() => void handleSave()}
            disabled={isSaving || !isDirty}
          >
            <Save size={16} />
            {isSaving ? 'Saving…' : 'Save skills'}
          </button>
        </div>

        <div className="config-list">
          {drafts.map((draft, index) => (
            <article key={draft.id} className="config-card">
              <div className="config-card-header">
                <div>
                  <p className="eyebrow">Skill {index + 1}</p>
                  <h4>{draft.name.trim() || 'Untitled skill'}</h4>
                </div>

                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    resetSaveMessage();
                    setDrafts((current) => removeSkillDraft(current, index));
                  }}
                  disabled={removeDisabled || isSaving}
                  title={removeDisabled ? 'At least one skill must remain configured.' : 'Remove skill'}
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              </div>

              <div className="config-field-grid">
                <label className="field">
                  <span className="field-label">Skill name</span>
                  <input
                    className="field-control"
                    value={draft.name}
                    onChange={(event) => {
                      resetSaveMessage();
                      setDrafts((current) =>
                        updateSkillDraft(current, index, { name: event.target.value })
                      );
                    }}
                    placeholder="summarize"
                    spellCheck={false}
                    disabled={isSaving}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Description</span>
                  <input
                    className="field-control"
                    value={draft.description}
                    onChange={(event) => {
                      resetSaveMessage();
                      setDrafts((current) =>
                        updateSkillDraft(current, index, { description: event.target.value })
                      );
                    }}
                    placeholder="Concise summary of what this skill does."
                    disabled={isSaving}
                  />
                </label>
              </div>

              <label className="field">
                <span className="field-label">Prompt</span>
                <textarea
                  className="field-control editor-textarea"
                  value={draft.prompt}
                  onChange={(event) => {
                    resetSaveMessage();
                    setDrafts((current) =>
                      updateSkillDraft(current, index, { prompt: event.target.value })
                    );
                  }}
                  placeholder="Write the prompt template used for this skill."
                  spellCheck={false}
                  disabled={isSaving}
                />
              </label>
            </article>
          ))}
        </div>

        {removeDisabled ? (
          <p className="field-help">At least one skill must remain configured.</p>
        ) : null}

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

function toSkillDrafts(skills: Record<string, SkillSavePayloadEntry>): SkillDraft[] {
  const drafts = createSkillDraftsFromConfig(skills);
  return drafts.length > 0 ? drafts : addSkillDraft([]);
}
