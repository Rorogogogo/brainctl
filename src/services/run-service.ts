import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AgentNotAvailableError, InputFileError } from '../errors.js';
import { loadConfig } from '../config.js';
import { buildContext } from '../context/builder.js';
import { loadMemory } from '../context/memory.js';
import { resolveSkillPrompt } from '../context/skills.js';
import { createExecutorResolver } from '../executor/resolver.js';
import type { ExecutorResolver } from '../executor/resolver.js';
import type { ExecutionStep, ExecutionTrace, RunRequest } from '../types.js';

export interface RunService {
  execute(
    request: RunRequest,
    options?: RunServiceExecuteOptions
  ): Promise<ExecutionTrace>;
}

export interface RunServiceExecuteOptions {
  onOutputChunk?: (chunk: string) => void;
}

interface RunServiceDependencies {
  resolver?: ExecutorResolver;
}

export function createRunService(
  dependencies: RunServiceDependencies = {}
): RunService {
  const resolver = dependencies.resolver ?? createExecutorResolver();

  return {
    async execute(
      request: RunRequest,
      options: RunServiceExecuteOptions = {}
    ): Promise<ExecutionTrace> {
      const cwd = request.cwd ?? process.cwd();
      const config = await loadConfig({ cwd });
      const memory = await loadMemory({ paths: config.memory.paths });
      const steps = buildExecutionPlan(request);
      const results = [];
      let previousOutput: string | undefined;

      for (const [stepIndex, step] of steps.entries()) {
        const input = await resolveInput(step, cwd, previousOutput);
        const skill = resolveSkillPrompt(config, step.skill);
        const context = buildContext({
          memory: memory.content,
          skill,
          input
        });

        let executor = await resolvePrimaryExecutor(resolver, step);
        let fallbackUsed = false;

        if (executor.fallbackRequired) {
          fallbackUsed = true;
        }

        const result = await executor.instance.run(context, {
          streamOutput: true,
          onOutputChunk: options.onOutputChunk
        });

        previousOutput = result.output;
        results.push({
          stepIndex,
          requestedAgent: step.primaryAgent,
          agent: result.agent,
          fallbackUsed,
          exitCode: result.exitCode,
          output: result.output
        });
      }

      const finalResult = results.at(-1);

      return {
        steps: results,
        finalOutput: finalResult?.output ?? '',
        finalExitCode: finalResult?.exitCode ?? 0
      };
    }
  };
}

export function buildExecutionPlan(request: RunRequest): ExecutionStep[] {
  return [
    {
      skill: request.skill,
      inputFile: request.inputFile,
      primaryAgent: request.primaryAgent,
      fallbackAgent: request.fallbackAgent,
      usePreviousOutput: false
    }
  ];
}

async function resolveInput(
  step: ExecutionStep,
  cwd: string,
  previousOutput: string | undefined
): Promise<string> {
  if (step.usePreviousOutput && previousOutput !== undefined) {
    return previousOutput;
  }

  const inputPath = path.resolve(cwd, step.inputFile);

  try {
    return await readFile(inputPath, 'utf8');
  } catch (error) {
    throw new InputFileError(`Could not read input file: ${step.inputFile}`);
  }
}

async function resolvePrimaryExecutor(resolver: ExecutorResolver, step: ExecutionStep) {
  try {
    return {
      instance: await resolver.resolveExecutor(step.primaryAgent),
      fallbackRequired: false
    };
  } catch (error) {
    if (!(error instanceof AgentNotAvailableError) || !step.fallbackAgent) {
      throw error;
    }

    return {
      instance: await resolver.resolveExecutor(step.fallbackAgent),
      fallbackRequired: true
    };
  }
}
