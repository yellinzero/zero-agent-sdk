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

export type StructuredOutputErrorReason =
  /** The model returned text that could not be parsed as JSON. */
  | 'parse_failed'
  /** The parsed value violated the requested schema. */
  | 'schema_mismatch'
  /** The synthetic structured-output tool exceeded the repair attempt budget. */
  | 'max_repairs'
  /** The model produced no structured output at all (e.g. empty response). */
  | 'no_output';

export interface StructuredOutputErrorContext {
  /** The raw text the model returned, when available. */
  rawText?: string;
  /** Output kind that was being parsed (e.g. 'object', 'array'). */
  kind?: string;
  /** Provider-reported finish reason for the final turn. */
  finishReason?: string;
  /** Cumulative usage for the agent run that produced this error. */
  usage?: import('./types.js').Usage;
  /** Number of repair attempts made before giving up (tool-synthesis only). */
  attempts?: number;
  /**
   * Validation messages from each repair attempt, oldest first.
   * Useful for debugging "why did the model keep failing".
   */
  repairHistory?: string[];
}

export class StructuredOutputError extends AgentError {
  public readonly reason: StructuredOutputErrorReason;
  public readonly rawText?: string;
  public readonly kind?: string;
  public readonly finishReason?: string;
  public readonly usage?: import('./types.js').Usage;
  public readonly attempts?: number;
  public readonly repairHistory?: string[];

  constructor(
    message: string,
    reason: StructuredOutputErrorReason,
    context: StructuredOutputErrorContext = {},
    cause?: Error
  ) {
    super(message, 'STRUCTURED_OUTPUT', cause);
    this.name = 'StructuredOutputError';
    this.reason = reason;
    this.rawText = context.rawText;
    this.kind = context.kind;
    this.finishReason = context.finishReason;
    this.usage = context.usage;
    this.attempts = context.attempts;
    this.repairHistory = context.repairHistory;
  }

  /** Backwards-friendly alias for `rawText` — convenient in logs. */
  get text(): string | undefined {
    return this.rawText;
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
  | 'STRUCTURED_OUTPUT'
  | 'UNKNOWN';
