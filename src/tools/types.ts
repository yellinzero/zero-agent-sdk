/**
 * SDKTool interface — the core tool abstraction for the SDK.
 * Stripped of all UI/rendering methods from the original Tool interface.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Tool Interface
// ---------------------------------------------------------------------------

export interface SDKTool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** Primary tool name */
  readonly name: string;

  /** Optional aliases for backwards compatibility */
  readonly aliases?: string[];

  /** Zod schema for validating tool input */
  readonly inputSchema: z.ZodType<TInput>;

  /** JSON Schema alternative (for MCP tools) */
  readonly inputJSONSchema?: ToolInputJSONSchema;

  /** Maximum result size before truncation/persistence */
  maxResultSizeChars: number;

  /** Execute the tool */
  call(
    args: TInput,
    context: ToolExecutionContext,
    onProgress?: ToolProgressFn
  ): Promise<SDKToolResult<TOutput>>;

  /** Generate the tool's description for the system prompt */
  description(options?: DescriptionOptions): Promise<string>;

  /** Generate the tool's prompt instructions */
  prompt(options: PromptOptions): Promise<string>;

  /** Check if this specific input requires permission */
  checkPermissions(input: TInput, context: ToolExecutionContext): Promise<PermissionCheckResult>;

  /** Validate input beyond schema validation */
  validateInput?(input: TInput, context: ToolExecutionContext): Promise<ValidationResult>;

  /** Whether this tool can safely run concurrently with other tool calls */
  isConcurrencySafe(input: TInput): boolean;

  /** Whether this tool only reads data (no side effects) */
  isReadOnly(input: TInput): boolean;

  /** Whether this tool performs irreversible operations */
  isDestructive?(input: TInput): boolean;

  /** Whether this tool is currently enabled */
  isEnabled(): boolean;

  /** Get the file path this tool operates on, if any */
  getPath?(input: TInput): string;

  /** Prepare a matcher for permission rule patterns */
  preparePermissionMatcher?(input: TInput): Promise<(pattern: string) => boolean>;

  /** Map tool result to the format expected by the provider */
  mapToolResult(content: TOutput, toolUseId: string): ToolResultParam;
}

// ---------------------------------------------------------------------------
// Tool JSON Schema
// ---------------------------------------------------------------------------

export interface ToolInputJSONSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tool Execution Context
// ---------------------------------------------------------------------------

export interface ToolExecutionContext {
  /** Current working directory */
  cwd: string;

  /** Abort signal for cancellation */
  abortSignal: AbortSignal;

  /** All available tools */
  tools: SDKTool[];

  /** Current conversation messages (provider-agnostic format) */
  messages: readonly ToolContextMessage[];

  /** Model being used */
  model: string;

  /** Debug mode */
  debug: boolean;

  /** Read file state cache — tracks what was read for staleness / completeness checks */
  readFileState: Map<string, ReadFileStateEntry>;

  /** Agent session state (mutable, instance-scoped) */
  getState(): AgentSessionState;
  setState(updater: (prev: AgentSessionState) => AgentSessionState): void;

  /** File read limits */
  fileReadingLimits?: {
    maxTokens?: number;
    maxSizeBytes?: number;
  };

  /** Glob result limits */
  globLimits?: {
    maxResults?: number;
  };

  /** Workspace root directories for file access boundary enforcement */
  workspaceRoots?: string[];

  /** Whether to enforce workspace boundary */
  enforceWorkspaceBoundary?: boolean;
}

export interface ToolContextMessage {
  role: 'user' | 'assistant';
  content: unknown[];
}

export interface AgentSessionState {
  [key: string]: unknown;
}

/**
 * Tracks what portion of a file was last read, used by Write/Edit tools
 * to enforce "read before write" and detect external modifications.
 */
export interface ReadFileStateEntry {
  /** The content that was actually read (may be a partial slice) */
  content: string;
  /** File mtime at the time of read (ms) */
  mtime: number;
  /** Total number of lines in the file at the time of read */
  totalLines?: number;
  /** 0-indexed line offset of the read start */
  readOffset?: number;
  /** Number of lines that were read */
  readLimit?: number;
  /** True when the entire file was read (offset=0, limit >= totalLines) */
  fullyRead?: boolean;
}

// ---------------------------------------------------------------------------
// ReadFileState pruning
// ---------------------------------------------------------------------------

const MAX_READ_FILE_STATE_ENTRIES = 200;

/**
 * Prune the readFileState Map if it exceeds the maximum size.
 * Removes the oldest entries (Map preserves insertion order).
 */
export function pruneReadFileState(state: Map<string, ReadFileStateEntry>): void {
  if (state.size <= MAX_READ_FILE_STATE_ENTRIES) return;
  const toDelete = state.size - Math.floor(MAX_READ_FILE_STATE_ENTRIES * 0.8);
  let deleted = 0;
  for (const key of state.keys()) {
    if (deleted >= toDelete) break;
    state.delete(key);
    deleted++;
  }
}

// ---------------------------------------------------------------------------
// Tool Result
// ---------------------------------------------------------------------------

export interface SDKToolResult<T = unknown> {
  data: T;
  /** Additional messages to inject into conversation */
  newMessages?: ToolContextMessage[];
  /** Modify execution context after this tool runs (only for non-concurrent tools) */
  contextModifier?: (context: ToolExecutionContext) => ToolExecutionContext;
}

export interface ToolResultParam {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown }>;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Progress
// ---------------------------------------------------------------------------

export type ToolProgressFn = (progress: ToolProgressEvent) => void;

export interface ToolProgressEvent {
  toolUseId: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Permission Check
// ---------------------------------------------------------------------------

export type PermissionCheckResult =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message: string }
  | { behavior: 'ask'; message: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { result: true }
  | { result: false; message: string; errorCode: number };

// ---------------------------------------------------------------------------
// Description / Prompt Options
// ---------------------------------------------------------------------------

export interface DescriptionOptions {
  tools: SDKTool[];
}

export interface PromptOptions {
  tools: SDKTool[];
}

// ---------------------------------------------------------------------------
// Tool Builder
// ---------------------------------------------------------------------------

export type SDKToolDef<TInput = Record<string, unknown>, TOutput = unknown> = Omit<
  SDKTool<TInput, TOutput>,
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'mapToolResult'
> &
  Partial<
    Pick<
      SDKTool<TInput, TOutput>,
      | 'isEnabled'
      | 'isConcurrencySafe'
      | 'isReadOnly'
      | 'isDestructive'
      | 'checkPermissions'
      | 'mapToolResult'
    >
  >;

/**
 * Build a complete SDKTool from a partial definition, applying safe defaults.
 */
export function buildSDKTool<TInput = Record<string, unknown>, TOutput = unknown>(
  def: SDKToolDef<TInput, TOutput>
): SDKTool<TInput, TOutput> {
  return {
    isEnabled: () => true,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isDestructive: () => false,
    checkPermissions: async (input) => ({ behavior: 'allow' as const, updatedInput: input }),
    mapToolResult: (content: TOutput, toolUseId: string) => ({
      type: 'tool_result' as const,
      tool_use_id: toolUseId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    }),
    ...def,
  };
}

/**
 * Check if a tool matches the given name (primary name or alias).
 */
export function toolMatchesName(tool: { name: string; aliases?: string[] }, name: string): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false);
}

/**
 * Find a tool by name or alias from a list of tools.
 */
export function findToolByName(tools: readonly SDKTool[], name: string): SDKTool | undefined {
  return tools.find((t) => toolMatchesName(t, name));
}
