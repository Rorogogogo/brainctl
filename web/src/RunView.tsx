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
  createRunDefaults,
  getRunAgentOptions,
  type RunAgentName,
  type RunWorkspace
} from './run-view';

interface RunViewProps {
  workspace: RunWorkspace;
}

interface RunExecutionStepResult {
  stepIndex: number;
  requestedAgent: RunAgentName;
  agent: RunAgentName;
  fallbackUsed: boolean;
  exitCode: number;
  output: string;
}

interface RunExecutionTrace {
  steps: RunExecutionStepResult[];
  finalOutput: string;
  finalExitCode: number;
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
  const streamRef = useRef<EventSource | null>(null);

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

    const source = new EventSource(
      buildRunStreamUrl({
        skill: selectedSkill,
        inputFile: selectedInputFile,
        primaryAgent: form.primaryAgent,
        fallbackAgent: form.fallbackAgent || undefined
      })
    );

    streamRef.current = source;
    let finished = false;

    source.addEventListener('output', (event) => {
      const chunk = (event as MessageEvent<string>).data;
      setOutput((current) => current + chunk);
    });

    source.addEventListener('result', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as RunExecutionTrace;
        finished = true;
        setResult(parsed);
        setState('success');
      } catch {
        setState('error');
        setErrorMessage('The run completed, but the final result payload could not be parsed.');
      } finally {
        source.close();
        if (streamRef.current === source) {
          streamRef.current = null;
        }
      }
    });

    source.onerror = () => {
      if (finished) {
        return;
      }

      setState('error');
      setErrorMessage('The run stream ended before a final result was received.');
      source.close();
      if (streamRef.current === source) {
        streamRef.current = null;
      }
    };
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

  return (
    <div className="view-stack run-view">
      <section className="panel-inner run-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Run workflow</p>
            <h3>Launch a streamed execution</h3>
          </div>
          <span className={`status-chip run-state ${state}`}>
            {state === 'running' ? <LoaderCircle size={14} className="run-state-spinner" /> : null}
            {statusLabel}
          </span>
        </div>

        <form className="run-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Skill</span>
            <select
              className="field-control"
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
            <span className="field-help">Uses the selected skill prompt from ai-stack.yaml.</span>
          </label>

          <label className="field">
            <span className="field-label">Input file path</span>
            <input
              className="field-control"
              value={form.inputFile}
              onChange={(event) =>
                setForm((current) => ({ ...current, inputFile: event.target.value }))
              }
              placeholder="./input.md"
              spellCheck={false}
            />
            <span className="field-help">Relative to the current workspace.</span>
          </label>

          <div className="run-agent-grid">
            <label className="field">
              <span className="field-label">Primary agent</span>
              <select
                className="field-control"
                value={form.primaryAgent}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    primaryAgent: event.target.value as RunAgentName
                  }))
                }
              >
                {agentOptions.map((agent) => (
                  <option key={agent.agent} value={agent.agent}>
                    {formatAgentOption(agent)}
                  </option>
                ))}
              </select>
              <span className="field-help">Unavailable agents stay selectable for fallback testing.</span>
            </label>

            <label className="field">
              <span className="field-label">Fallback agent</span>
              <select
                className="field-control"
                value={form.fallbackAgent}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fallbackAgent: event.target.value as RunFormState['fallbackAgent']
                  }))
                }
              >
                <option value="">None</option>
                {agentOptions.map((agent) => (
                  <option key={agent.agent} value={agent.agent}>
                    {formatAgentOption(agent)}
                  </option>
                ))}
              </select>
              <span className="field-help">Used only if the primary agent is unavailable.</span>
            </label>
          </div>

          <div className="run-actions">
            <button className="run-button" type="submit" disabled={!canRun}>
              {state === 'running' ? <LoaderCircle size={16} className="run-button-spinner" /> : <Play size={16} />}
              {state === 'running' ? 'Running' : 'Run'}
            </button>
            <p className="field-help">
              Streams output from <code>/api/run/stream</code> and clears the previous run on submit.
            </p>
          </div>
        </form>
      </section>

      <div className="run-detail-grid">
        <section className="panel-inner run-output-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Live output</p>
              <h3>Streaming surface</h3>
            </div>
            <span className="muted-pill">EventSource</span>
          </div>

          <textarea
            className="run-output"
            readOnly
            spellCheck={false}
            value={output}
            placeholder="Run output will stream here."
            aria-label="Live run output"
          />
        </section>

        <section className="panel-inner run-summary-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Final status</p>
              <h3>Execution summary</h3>
            </div>
            <span className="muted-pill">
              {state === 'success' ? 'Complete' : state === 'error' ? 'Needs attention' : 'Pending'}
            </span>
          </div>

          {result && latestStep ? (
            <div className="run-summary-grid">
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
    <article className="run-summary-tile">
      <span className="run-summary-tile-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="run-summary-tile-label">{label}</span>
      <strong className="run-summary-tile-value">{value}</strong>
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
      <div className="run-empty-state is-error">
        <CircleAlert size={18} aria-hidden="true" />
        <div>
          <strong>Run failed before completion</strong>
          <p>{errorMessage ?? 'The stream ended without a result payload.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="run-empty-state">
      <CircleCheck size={18} aria-hidden="true" />
      <div>
        <strong>No completed run yet</strong>
        <p>Start a run to see the final exit code and selected agent here.</p>
      </div>
    </div>
  );
}

function formatAgentOption(agent: { agent: RunAgentName; available: boolean }): string {
  return `${AGENT_LABELS[agent.agent]}${agent.available ? '' : ' (unavailable)'}`;
}
