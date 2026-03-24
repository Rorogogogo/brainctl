import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface InitServiceRequest {
  cwd?: string;
  force?: boolean;
}

export interface InitServiceResult {
  created: string[];
  replaced: string[];
  skipped: string[];
  alreadyInitialized: boolean;
}

export interface InitService {
  execute(request?: InitServiceRequest): Promise<InitServiceResult>;
}

const SAMPLE_CONFIG = `memory:
  paths:
    - ./memory

skills:
  summarize:
    description: Summarize content
    prompt: |
      Summarize the following content into concise bullet points.

  analyze:
    description: Analyze content deeply
    prompt: |
      Analyze the following content and extract key insights.

mcps: {}
`;

const SAMPLE_MEMORY = `# Team Notes

- Track important project context here.
- Keep prompts and references concise.
`;

export function createInitService(): InitService {
  return {
    async execute(request: InitServiceRequest = {}): Promise<InitServiceResult> {
      const cwd = request.cwd ?? process.cwd();
      const force = request.force ?? false;
      const configPath = path.join(cwd, 'ai-stack.yaml');
      const memoryDir = path.join(cwd, 'memory');
      const notesPath = path.join(memoryDir, 'notes.md');

      const created: string[] = [];
      const replaced: string[] = [];
      const skipped: string[] = [];

      await writeManagedFile({
        targetPath: configPath,
        content: SAMPLE_CONFIG,
        force,
        created,
        replaced,
        skipped
      });

      const memoryDirExists = await pathExists(memoryDir);
      if (!memoryDirExists) {
        await mkdir(memoryDir, { recursive: true });
        created.push(memoryDir);
      }

      await writeManagedFile({
        targetPath: notesPath,
        content: SAMPLE_MEMORY,
        force,
        created,
        replaced,
        skipped
      });

      return {
        created,
        replaced,
        skipped,
        alreadyInitialized: created.length === 0 && replaced.length === 0
      };
    }
  };
}

interface ManagedWriteOptions {
  targetPath: string;
  content: string;
  force: boolean;
  created: string[];
  replaced: string[];
  skipped: string[];
}

async function writeManagedFile(options: ManagedWriteOptions): Promise<void> {
  const exists = await pathExists(options.targetPath);

  if (exists && !options.force) {
    options.skipped.push(options.targetPath);
    return;
  }

  await mkdir(path.dirname(options.targetPath), { recursive: true });
  await writeFile(options.targetPath, options.content, 'utf8');

  if (exists) {
    options.replaced.push(options.targetPath);
    return;
  }

  options.created.push(options.targetPath);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
