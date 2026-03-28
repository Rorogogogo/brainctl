import type { ServerResponse } from 'node:http';

export function startSseStream(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();
}

export function writeSseEvent(
  response: ServerResponse,
  event: string,
  data: unknown
): void {
  response.write(`event: ${event}\n`);

  const payload =
    typeof data === 'string' ? data : JSON.stringify(data);

  for (const line of payload.split(/\r?\n/)) {
    response.write(`data: ${line}\n`);
  }

  response.write('\n');
}
