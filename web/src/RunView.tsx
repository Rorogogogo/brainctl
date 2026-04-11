import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Play,
  Terminal
} from 'lucide-react';

import {
  buildRunStreamUrl,
  connectRunStream,
  createRunDefaults,
  getRunAgentOptions,
  getRunFallbackAgentOptions,
  normalizeRunFallbackAgent,
  type RunExecutionTrace,
  type RunAgentName,
  type RunWorkspace
} from './run-view';

interface RunViewProps {
  workspace: RunWorkspace;
}

interface RunFormState {
  skill: string;
  inputFile: string;
  primaryAgent: RunAgentName;
  fallbackAgent: '' | RunAgentName;
}

type RunState = 'idle' | 'running' | 'success' | 'error';

const AGENT_LABELS: Record<RunAgentName, string> = {
  claude: 'Claude',
  codex: 'Codex'
};

export default function RunView({ workspace }: RunViewProps) {
  const [form, setForm] = useState<RunFormState>(() => createRunDefaults(workspace));
  const [state, setState] = useState<RunState>('idle');
  const [output, setOutput] = useState('');
  const [result, setResult] = useState<RunExecutionTrace | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const streamRef = useRef<{ close(): void } | null>(null);

  useEffect(() => {
    setForm(createRunDefaults(workspace));
  }, [workspace]);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  const agentOptions = getRunAgentOptions(workspace);
  const fallbackAgentOptions = getRunFallbackAgentOptions(workspace, form.primaryAgent);
  const selectedSkill = form.skill.trim();
  const selectedInputFile = form.inputFile.trim();
  const canRun = state !== 'running' && selectedSkill.length > 0 && selectedInputFile.length > 0;
  const latestStep = result?.steps.at(-1) ?? null;
  const chosenAgent = latestStep ? AGENT_LABELS[latestStep.agent] : null;
  const requestedAgent = latestStep ? AGENT_LABELS[latestStep.requestedAgent] : null;

  function startRun(): void {
    streamRef.current?.close();
    streamRef.current = null;

    setState('running');
    setOutput('');
    setResult(null);
    setErrorMessage(null);

    const connection = connectRunStream({
      url: buildRunStreamUrl({
        skill: selectedSkill,
        inputFile: selectedInputFile,
        primaryAgent: form.primaryAgent,
        fallbackAgent: form.fallbackAgent || undefined
      }),
      createEventSource: (streamUrl) => new EventSource(streamUrl),
      onOutputChunk(chunk) {
        setOutput((current) => current + chunk);
      },
      onResult(trace) {
        setResult(trace);
        setState('success');
      },
      onError(message) {
        setState('error');
        setErrorMessage(message);
      }
    });

    streamRef.current = connection;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!canRun) {
      return;
    }

    startRun();
  }

  const statusLabel =
    state === 'running'
      ? 'Running'
      : state === 'success'
        ? 'Finished'
        : state === 'error'
          ? 'Stream failed'
          : 'Ready';

  const stateClasses = {
    idle: 'border-zinc-200/80 bg-white text-zinc-500',
    running: 'border-zinc-200 bg-zinc-100 text-zinc-700',
    success: 'border-emerald-200/80 bg-emerald-50/50 text-emerald-800',
    error: 'border-red-200/80 bg-red-50/50 text-red-800',
  }[state];

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm lg:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Run workflow</p>
            <h3 className="m-0 text-xl font-semibold tracking-tight text-zinc-900">Launch a streamed execution</h3>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium shadow-sm transition-colors ${stateClasses}`}>
            {state === 'running' ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {statusLabel}
          </span>
        </div>

        <form className="grid gap-5" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm">
            <span className="font-semibold text-zinc-800">Skill</span>
            <select
              className="min-h-[44px] w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
              value={form.skill}
              onChange={(event) => setForm((current) => ({ ...current, skill: event.target.value }))}
            >
              {workspace.skills.length === 0 ? (
                <option value="">No skills configured</option>
              ) : null}
              {workspace.skills.map((skill) => (
                <option key={skill} value={skill}>
                  {skill}
                </option>
              ))}
            </select>
            <span className="text-[13px] leading-relaxed text-zinc-500">Uses the selected skill prompt from ai-stack.yaml.</span>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="font-semibold text-zinc-800">Input file path</span>
            <input
              className="min-h-[44px] w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
              value={form.inputFile}
              onChange={(event) =>
                setForm((current) => ({ ...current, inputFile: event.target.value }))
              }
              placeholder="./input.md"
              spellCheck={false}
            />
            <span className="text-[13px] leading-relaxed text-zinc-500">Relative to the current workspace.</span>
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-zinc-800">Primary agent</span>
              <select
                className="min-h-[44px] w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
                value={form.primaryAgent}
                onChange={(event) =>
                  setForm((current) => {
                    const nextPrimary = event.target.value as RunAgentName;

                    return {
                      ...current,
                      primaryAgent: nextPrimary,
                      fallbackAgent: normalizeRunFallbackAgent(nextPrimary, current.fallbackAgent)
                    };
                  })
                }
              >
                {agentOptions.map((agent) => (
                  <option key={agent.agent} value={agent.agent}>
                    {formatAgentOption(agent)}
                  </option>
                ))}
              </select>
              <span className="text-[13px] leading-relaxed text-zinc-500">Unavailable agents stay selectable for fallback testing.</span>
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-zinc-800">Fallback agent</span>
              <select
                className="min-h-[44px] w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
                value={form.fallbackAgent}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fallbackAgent: event.target.value as RunFormState['fallbackAgent']
                  }))
                }
              >
                <option value="">None</option>
                {fallbackAgentOptions.map((agent) => (
                  <option key={agent.agent} value={agent.agent}>
                    {formatAgentOption(agent)}
                  </option>
                ))}
              </select>
              <span className="text-[13px] leading-relaxed text-zinc-500">Used only if the primary agent is unavailable.</span>
            </label>
          </div>

          <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center">
            <button
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-md transition-all hover:bg-zinc-800 hover:shadow-lg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
              type="submit"
              disabled={!canRun}
            >
              {state === 'running' ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
              {state === 'running' ? 'Running' : 'Run'}
            </button>
            <p className="text-[13px] leading-relaxed text-zinc-500">
              Streams output from <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-800">/api/run/stream</code> and clears the previous run on submit.
            </p>
          </div>
        </form>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.9fr)]">
        <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm lg:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Live output</p>
              <h3 className="m-0 text-xl font-semibold tracking-tight text-zinc-900">Streaming surface</h3>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">EventSource</span>
          </div>

          <textarea
            className="min-h-[360px] w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 font-mono text-[13px] leading-relaxed text-zinc-800 shadow-sm outline-none transition-all placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100"
            readOnly
            spellCheck={false}
            value={output}
            placeholder="Run output will stream here."
            aria-label="Live run output"
          />
        </section>

        <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm lg:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Final status</p>
              <h3 className="m-0 text-xl font-semibold tracking-tight text-zinc-900">Execution summary</h3>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">
              {state === 'success' ? 'Complete' : state === 'error' ? 'Needs attention' : 'Pending'}
            </span>
          </div>

          {result && latestStep ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SummaryTile icon={CircleCheck} label="Exit status" value={String(result.finalExitCode)} />
              <SummaryTile icon={Terminal} label="Agent used" value={chosenAgent ?? 'n/a'} />
              <SummaryTile
                icon={Play}
                label="Requested agent"
                value={requestedAgent ?? 'n/a'}
              />
              <SummaryTile
                icon={CircleAlert}
                label="Fallback"
                value={latestStep.fallbackUsed ? 'Used' : 'Not used'}
              />
            </div>
          ) : (
            <EmptyRunSummary state={state} errorMessage={errorMessage} />
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <article className="flex items-center gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-zinc-200/80 bg-white text-zinc-600 shadow-sm" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400">{label}</span>
        <strong className="mt-0.5 block truncate text-sm font-semibold text-zinc-900">{value}</strong>
      </div>
    </article>
  );
}

function EmptyRunSummary({
  state,
  errorMessage
}: {
  state: RunState;
  errorMessage: string | null;
}) {
  if (state === 'error') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-200/80 bg-red-50/50 p-4 text-sm text-red-800">
        <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <strong className="mb-1 block font-semibold">Run failed before completion</strong>
          <p className="text-red-700/90">{errorMessage ?? 'The stream ended without a result payload.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 text-sm text-zinc-600">
      <CircleCheck size={18} className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" />
      <div>
        <strong className="mb-1 block font-semibold text-zinc-900">No completed run yet</strong>
        <p>Start a run to see the final exit code and selected agent here.</p>
      </div>
    </div>
  );
}

function formatAgentOption(agent: { agent: RunAgentName; available: boolean }): string {
  return `${AGENT_LABELS[agent.agent]}${agent.available ? '' : ' (unavailable)'}`;
}
