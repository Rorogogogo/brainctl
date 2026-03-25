import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface MemoryWriteRequest {
  filePath: string;
  content: string;
}

export interface MemoryWriteResult {
  filePath: string;
}

export interface MemoryWriteService {
  execute(request: MemoryWriteRequest): Promise<MemoryWriteResult>;
}

export function createMemoryWriteService(): MemoryWriteService {
  return {
    async execute(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
      await mkdir(path.dirname(request.filePath), { recursive: true });
      await writeFile(request.filePath, request.content, 'utf8');

      return { filePath: request.filePath };
    }
  };
}
