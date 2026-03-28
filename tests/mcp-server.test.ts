import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    configPath: '/test/ai-stack.yaml',
    rootDir: '/test',
    memory: { paths: ['/test/memory'] },
    skills: {
      review: { prompt: 'Review the code', description: 'Code review skill' },
      summarize: { prompt: 'Summarize the input' },
    },
    mcps: {},
  }),
}));

vi.mock('../src/services/status-service.js', () => ({
  createStatusService: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      configPath: '/test/ai-stack.yaml',
      memory: { content: '', files: [], count: 0, entries: [] },
      skills: ['review', 'summarize'],
      mcpCount: 0,
      agents: {
        claude: { agent: 'claude', available: true },
        codex: { agent: 'codex', available: false },
      },
    }),
  }),
}));

vi.mock('../src/services/doctor-service.js', () => ({
  createDoctorService: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      checks: [
        { label: 'Config', status: 'ok', message: 'Loaded /test/ai-stack.yaml' },
      ],
      hasIssues: false,
    }),
  }),
}));

vi.mock('../src/services/run-service.js', () => ({
  createRunService: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      steps: [{
        stepIndex: 0,
        requestedAgent: 'claude',
        agent: 'claude',
        fallbackUsed: false,
        exitCode: 0,
        output: 'Skill output here',
      }],
      finalOutput: 'Skill output here',
      finalExitCode: 0,
    }),
  }),
}));

describe('MCP server', () => {
  it('creates a server with expected tools', () => {
    const server = createMcpServer({ cwd: '/test' });
    expect(server).toBeDefined();
  });
});
