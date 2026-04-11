/**
 * Error types for the agent SDK.
 */

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export class ProviderError extends AgentError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly providerId?: string,
    cause?: Error
  ) {
    super(message, 'PROVIDER_ERROR', cause);
    this.name = 'ProviderError';
  }
}

export class ToolExecutionError extends AgentError {
  constructor(
    message: string,
    public readonly toolName: string,
    cause?: Error
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', cause);
    this.name = 'ToolExecutionError';
  }
}

export class PermissionDeniedError extends AgentError {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly input: unknown
  ) {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionDeniedError';
  }
}

export class BudgetExceededError extends AgentError {
  constructor(
    message: string,
    public readonly budgetType: 'tokens' | 'cost' | 'turns'
  ) {
    super(message, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
  }
}

export class AbortError extends AgentError {
  constructor(message: string = 'Operation aborted') {
    super(message, 'ABORTED');
    this.name = 'AbortError';
  }
}

export type AgentErrorCode =
  | 'PROVIDER_ERROR'
  | 'TOOL_EXECUTION_ERROR'
  | 'PERMISSION_DENIED'
  | 'BUDGET_EXCEEDED'
  | 'ABORTED'
  | 'INVALID_CONFIG'
  | 'MCP_ERROR'
  | 'CONTEXT_OVERFLOW'
  | 'UNKNOWN';
