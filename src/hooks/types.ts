/**
 * Hook system types — supports function-based hooks (not just shell commands).
 */

// ---------------------------------------------------------------------------
// Hook Events
// ---------------------------------------------------------------------------

export type HookEventType =
  | 'preToolUse'
  | 'postToolUse'
  | 'preQuery'
  | 'postQuery'
  | 'onError'
  | 'onTurnStart'
  | 'onTurnEnd'
  | 'onCompact';

// ---------------------------------------------------------------------------
// Hook Timeout Options
// ---------------------------------------------------------------------------

export interface HookTimeoutOptions {
  /** Per-hook timeout in milliseconds (default: 30_000). */
  timeoutMs?: number;
  /** Behaviour when a hook times out: 'warn' logs and continues, 'throw' re-throws (default: 'warn'). */
  onTimeout?: 'warn' | 'throw';
}

// ---------------------------------------------------------------------------
// Hook Error
// ---------------------------------------------------------------------------

/**
 * Structured error that wraps the original error thrown by (or caused by) a
 * hook function.  Includes the hook name and the index within the hook array
 * so callers can identify exactly which hook failed.
 */
export class HookError extends Error {
  override readonly name = 'HookError';

  constructor(
    message: string,
    /** The hook lifecycle point (e.g. 'preQuery'). */
    public readonly hookName: string,
    /** Zero-based index of the failing function within the hook array. */
    public readonly index: number,
    /** The original error that caused this HookError. */
    public readonly cause: Error
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Hook Config
// ---------------------------------------------------------------------------

/** A single hook function or an array of hook functions. */
export type HookFnOrArray<E> = HookFn<E> | HookFn<E>[];

export interface HookConfig {
  preToolUse?: HookFnOrArray<PreToolUseEvent>;
  postToolUse?: HookFnOrArray<PostToolUseEvent>;
  preQuery?: HookFnOrArray<PreQueryEvent>;
  postQuery?: HookFnOrArray<PostQueryEvent>;
  onError?: HookFnOrArray<ErrorHookEvent>;
  onTurnStart?: HookFnOrArray<TurnStartHookEvent>;
  onTurnEnd?: HookFnOrArray<TurnEndHookEvent>;
  onCompact?: HookFnOrArray<CompactHookEvent>;

  /** Global timeout options applied to every hook unless overridden. */
  timeout?: HookTimeoutOptions;
  /** Error handler for hook failures — called instead of console.error */
  onHookError?: (hookName: string, error: HookError) => void;
}

export type HookFn<E> = (event: E) => Promise<HookResult> | HookResult;

// ---------------------------------------------------------------------------
// Hook Events
// ---------------------------------------------------------------------------

export interface PreToolUseEvent {
  type: 'preToolUse';
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
}

export interface PostToolUseEvent {
  type: 'postToolUse';
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  toolResult: unknown;
  isError: boolean;
  durationMs: number;
}

export interface PreQueryEvent {
  type: 'preQuery';
  messageCount: number;
  turnNumber: number;
}

export interface PostQueryEvent {
  type: 'postQuery';
  stopReason: string;
  turnNumber: number;
  outputTokens: number;
}

export interface ErrorHookEvent {
  type: 'onError';
  error: Error;
  toolName?: string;
}

export interface TurnStartHookEvent {
  type: 'onTurnStart';
  turnNumber: number;
}

export interface TurnEndHookEvent {
  type: 'onTurnEnd';
  turnNumber: number;
  stopReason: string;
}

export interface CompactHookEvent {
  type: 'onCompact';
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
}

// ---------------------------------------------------------------------------
// Hook Result
// ---------------------------------------------------------------------------

export interface HookResult {
  /** Whether to continue execution (default: true) */
  continue?: boolean;

  /** Reason for stopping (when continue is false) */
  stopReason?: string;

  /** Updated tool input (for preToolUse hooks) */
  updatedInput?: unknown;

  /** Additional context to inject into the conversation */
  additionalContext?: string;
}
