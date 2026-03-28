export type RunAgentName = 'claude' | 'codex';

export interface RunAgentStatus {
  agent: RunAgentName;
  available: boolean;
  command?: string;
}

export interface RunWorkspace {
  skills: string[];
  agents: Record<RunAgentName, RunAgentStatus>;
}

export interface RunDefaults {
  skill: string;
  inputFile: string;
  primaryAgent: RunAgentName;
  fallbackAgent: '' | RunAgentName;
}

export interface RunAgentOption extends RunAgentStatus {}

export interface RunStreamParams {
  skill: string;
  inputFile: string;
  primaryAgent: RunAgentName;
  fallbackAgent?: RunAgentName;
}

export interface RunExecutionStepResult {
  stepIndex: number;
  requestedAgent: RunAgentName;
  agent: RunAgentName;
  fallbackUsed: boolean;
  exitCode: number;
  output: string;
}

export interface RunExecutionTrace {
  steps: RunExecutionStepResult[];
  finalOutput: string;
  finalExitCode: number;
}

export interface RunStreamSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
  onerror: null | (() => void);
}

export interface RunStreamConnection {
  close(): void;
}

export interface RunStreamHandlers {
  onOutputChunk: (chunk: string) => void;
  onResult: (trace: RunExecutionTrace) => void;
  onError: (message: string) => void;
}

export interface ConnectRunStreamOptions extends RunStreamHandlers {
  url: string;
  createEventSource: (url: string) => RunStreamSourceLike;
}

const AGENT_ORDER: RunAgentName[] = ['claude', 'codex'];

export function createRunDefaults(workspace: RunWorkspace): RunDefaults {
  const primaryAgent =
    AGENT_ORDER.find((agent) => workspace.agents[agent]?.available) ?? AGENT_ORDER[0];

  return {
    skill: workspace.skills[0] ?? '',
    inputFile: './input.md',
    primaryAgent,
    fallbackAgent: ''
  };
}

export function getRunAgentOptions(workspace: RunWorkspace): RunAgentOption[] {
  return AGENT_ORDER.map((agent) => workspace.agents[agent]);
}

export function getRunFallbackAgentOptions(
  workspace: RunWorkspace,
  primaryAgent: RunAgentName
): RunAgentOption[] {
  return AGENT_ORDER.filter((agent) => agent !== primaryAgent).map((agent) => workspace.agents[agent]);
}

export function normalizeRunFallbackAgent(
  primaryAgent: RunAgentName,
  fallbackAgent: '' | RunAgentName
): '' | RunAgentName {
  if (fallbackAgent === primaryAgent) {
    return '';
  }

  return fallbackAgent;
}

export function buildRunStreamUrl(params: RunStreamParams): string {
  const searchParams = new URLSearchParams({
    skill: params.skill,
    inputFile: params.inputFile,
    primaryAgent: params.primaryAgent
  });

  if (params.fallbackAgent) {
    searchParams.set('fallbackAgent', params.fallbackAgent);
  }

  return `/api/run/stream?${searchParams.toString()}`;
}

export function connectRunStream(options: ConnectRunStreamOptions): RunStreamConnection {
  const source = options.createEventSource(options.url);
  let finished = false;

  source.addEventListener('output', (event) => {
    options.onOutputChunk(event.data);
  });

  source.addEventListener('result', (event) => {
    finished = true;

    try {
      const trace = JSON.parse(event.data) as RunExecutionTrace;
      options.onResult(trace);
    } catch {
      options.onError('The run completed, but the final result payload could not be parsed.');
    } finally {
      source.close();
    }
  });

  source.addEventListener('run-error', (event) => {
    finished = true;

    try {
      const payload = JSON.parse(event.data) as { error?: string };
      options.onError(payload.error ?? 'The run failed before a final result was received.');
    } catch {
      options.onError('The run failed before a final result was received.');
    } finally {
      source.close();
    }
  });

  source.onerror = () => {
    if (finished) {
      return;
    }

    options.onError('The run stream ended before a final result was received.');
    source.close();
  };

  return {
    close() {
      source.close();
    }
  };
}
