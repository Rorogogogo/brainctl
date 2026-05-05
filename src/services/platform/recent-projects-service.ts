import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_RECENTS = 20;
const FILE_VERSION = 1;

interface RecentsFile {
  version: number;
  recents: string[];
}

interface FsLike {
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  mkdir(p: string, opts?: { recursive: boolean }): Promise<unknown>;
}

export interface RecentProjectsService {
  read(): Promise<string[]>;
  addRecent(cwd: string): Promise<string[]>;
}

const defaultFs: FsLike = {
  readFile: (p) => readFile(p, 'utf8'),
  writeFile: (p, content) => writeFile(p, content, 'utf8'),
  mkdir: (p, opts) => mkdir(p, opts),
};

export function createRecentProjectsService(deps: {
  filePath: string;
  fs?: FsLike;
}): RecentProjectsService {
  const { filePath, fs: fsImpl = defaultFs } = deps;

  async function readFile_(): Promise<RecentsFile | null> {
    try {
      const content = await fsImpl.readFile(filePath);
      const parsed = JSON.parse(content) as unknown;
      if (typeof parsed === 'object' && parsed !== null && 'recents' in parsed) {
        return parsed as RecentsFile;
      }
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async function persist(recents: string[]): Promise<void> {
    const dir = path.dirname(filePath);
    await fsImpl.mkdir(dir, { recursive: true });
    const data: RecentsFile = { version: FILE_VERSION, recents };
    await fsImpl.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async function read(): Promise<string[]> {
    const data = await readFile_();
    if (!data) return [];
    return (data.recents ?? []).filter((e): e is string => typeof e === 'string');
  }

  async function addRecent(cwd: string): Promise<string[]> {
    if (!path.isAbsolute(cwd)) {
      throw new Error(`cwd must be an absolute path, got: ${cwd}`);
    }

    const current = await read();
    const deduplicated = current.filter((p) => p !== cwd);
    const updated = [cwd, ...deduplicated].slice(0, MAX_RECENTS);

    await persist(updated);
    return updated;
  }

  return { read, addRecent };
}
