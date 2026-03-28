import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createUiRouteHandler } from './routes.js';
import type { StatusService } from '../services/status-service.js';

export interface StartUiServerOptions {
  cwd?: string;
  host?: string;
  port?: number;
  statusService?: StatusService;
}

export interface UiServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

export async function startUiServer(
  options: StartUiServerOptions = {}
): Promise<UiServer> {
  const cwd = options.cwd ?? process.cwd();
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3333;
  const handler = createUiRouteHandler({
    cwd,
    statusService: options.statusService
  });

  const server = createServer(async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unexpected server error'
        })
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('UI server did not bind to a TCP port.');
  }

  const actualAddress = address as AddressInfo;
  const url = `http://${formatHost(host)}:${actualAddress.port}`;

  return {
    server,
    url,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}
