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
    <div className="grid gap-6">
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm lg:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Skills</p>
            <h3 className="m-0 text-xl font-semibold tracking-tight text-zinc-900">Structured prompt library</h3>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">{drafts.length} configured</span>
        </div>

        <p className="text-sm leading-relaxed text-zinc-500">
          Edit the skill name, description, and prompt body that feed <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-800">brainctl run</code>.
        </p>

        <div className="my-6 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
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
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-md transition-all hover:bg-zinc-800 hover:shadow-lg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={isSaving || !isDirty}
          >
            <Save size={16} />
            {isSaving ? 'Saving…' : 'Save skills'}
          </button>
        </div>

        <div className="grid gap-6">
          {drafts.map((draft, index) => (
            <article key={draft.id} className="grid gap-5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Skill {index + 1}</p>
                  <h4 className="m-0 text-base font-semibold text-zinc-900">{draft.name.trim() || 'Untitled skill'}</h4>
                </div>

                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg border border-red-200/80 bg-white px-3.5 text-sm font-medium text-red-600 shadow-sm transition-all hover:bg-red-50 hover:text-red-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
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

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-zinc-800">Skill name</span>
                  <input
                    className="min-h-[44px] w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
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

                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-zinc-800">Description</span>
                  <input
                    className="min-h-[44px] w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
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

              <label className="grid gap-2 text-sm">
                <span className="font-semibold text-zinc-800">Prompt</span>
                <textarea
                  className="min-h-[180px] w-full resize-y rounded-xl border border-zinc-200 bg-white p-4 text-[13px] leading-relaxed text-zinc-900 shadow-sm outline-none transition-all placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
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
          <p className="mt-4 text-[13px] leading-relaxed text-zinc-500">At least one skill must remain configured.</p>
        ) : null}

        {message ? (
          <div className="mt-6">
            <SaveFeedback
              state={saveState}
              message={message}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SaveFeedback({ state, message }: { state: SaveState; message: string }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-all ${state === 'error' ? 'border-red-200/80 bg-red-50/50 text-red-800' : 'border-emerald-200/80 bg-emerald-50/50 text-emerald-800'}`} aria-live="polite">
      {state === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
      <span>{message}</span>
    </div>
  );
}

function toSkillDrafts(skills: Record<string, SkillSavePayloadEntry>): SkillDraft[] {
  const drafts = createSkillDraftsFromConfig(skills);
  return drafts.length > 0 ? drafts : addSkillDraft([]);
}
