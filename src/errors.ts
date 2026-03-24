import type { ErrorCategory } from './types.js';

export class BrainctlError extends Error {
  public readonly category: ErrorCategory;
  public readonly code: string;

  public constructor(message: string, category: ErrorCategory, code: string) {
    super(message);
    this.name = new.target.name;
    this.category = category;
    this.code = code;
  }
}

export class ConfigError extends BrainctlError {
  public constructor(message: string) {
    super(message, 'user', 'CONFIG_ERROR');
  }
}

export class ValidationError extends BrainctlError {
  public constructor(message: string) {
    super(message, 'user', 'VALIDATION_ERROR');
  }
}

export class MemoryPathError extends BrainctlError {
  public constructor(message: string) {
    super(message, 'user', 'MEMORY_PATH_ERROR');
  }
}

export class SkillNotFoundError extends BrainctlError {
  public constructor(message: string) {
    super(message, 'user', 'SKILL_NOT_FOUND');
  }
}

export class InputFileError extends BrainctlError {
  public constructor(message: string) {
    super(message, 'user', 'INPUT_FILE_ERROR');
  }
}

export class AgentNotAvailableError extends BrainctlError {
  public constructor(message: string) {
    super(message, 'user', 'AGENT_NOT_AVAILABLE');
  }
}

export class ExecutionError extends BrainctlError {
  public constructor(message: string) {
    super(message, 'system', 'EXECUTION_ERROR');
  }
}
