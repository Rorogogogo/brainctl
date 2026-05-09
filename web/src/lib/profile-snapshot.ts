type Agent = 'claude' | 'codex' | 'gemini';

interface SnapshotProfileOptions {
  agent: Agent;
  as?: string;
  onProgress: (message: string) => void;
}

interface SnapshotProfileResult {
  profileName: string;
  profilePath: string;
}

type SnapshotProgressEvent =
  | { type: 'progress'; message: string }
  | { type: 'result'; profileName: string; profilePath: string }
  | { type: 'error'; error: string };

export async function snapshotProfile(
  options: SnapshotProfileOptions
): Promise<SnapshotProfileResult> {
  const response = await fetch('/api/profiles/snapshot', {
    method: 'POST',
    headers: {
      accept: 'application/x-ndjson',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      agent: options.agent,
      ...(options.as ? { as: options.as } : {}),
    }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }

  if (!response.body) {
    const data = (await response.json()) as SnapshotProfileResult;
    return data;
  }

  let result: SnapshotProfileResult | null = null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  while (true) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const event = JSON.parse(line) as SnapshotProgressEvent;
      if (event.type === 'progress') {
        options.onProgress(event.message);
      } else if (event.type === 'result') {
        result = {
          profileName: event.profileName,
          profilePath: event.profilePath,
        };
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

    if (done) break;
  }

  if (buffered.trim().length > 0) {
    const event = JSON.parse(buffered) as SnapshotProgressEvent;
    if (event.type === 'result') {
      result = { profileName: event.profileName, profilePath: event.profilePath };
    } else if (event.type === 'error') {
      throw new Error(event.error);
    }
  }

  if (!result) {
    throw new Error('Snapshot did not return a result.');
  }

  return result;
}
