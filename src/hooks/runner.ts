/**
 * Hook execution engine — runs function-based hooks at various lifecycle points.
 * Supports hook arrays, timeouts, and structured error reporting.
 */

import type {
  CompactHookEvent,
  ErrorHookEvent,
  HookConfig,
  HookFn,
  HookFnOrArray,
  HookResult,
  HookTimeoutOptions,
  PostQueryEvent,
  PostToolUseEvent,
  PreQueryEvent,
  PreToolUseEvent,
  TurnEndHookEvent,
  TurnStartHookEvent,
} from './types.js';
import { HookError } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HOOK_RESULT: HookResult = { continue: true };
const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Result of running a hook chain
// ---------------------------------------------------------------------------

export interface HookChainResult {
  /** Merged hook result (continue / stopReason / updatedInput / etc.). */
  result: HookResult;
  /** Errors collected from individual hooks that failed during execution. */
  errors: HookError[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Execute a promise with a timeout guard.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, hookName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Hook "${hookName}" timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Normalize a hook value (single fn or array) into an array.
 */
function normalizeHook<E>(hook: HookFnOrArray<E> | undefined): HookFn<E>[] {
  if (!hook) return [];
  return Array.isArray(hook) ? hook : [hook];
}

// ---------------------------------------------------------------------------
// Core chain runner
// ---------------------------------------------------------------------------

/**
 * Execute one or more hook functions sequentially with structured error handling.
 *
 * - Normalises a single function into an array.
 * - Wraps each invocation in a per-hook timeout (default 30 s).
 * - On error: wraps in {@link HookError}, reports via callback, and continues
 *   to the next hook (unless `onTimeout` is `'throw'` for timeout errors).
 * - Returns both the merged {@link HookResult} and an array of collected
 *   {@link HookError}s so the caller can inspect failures.
 */
export async function runHookChain<E>(
  hookName: string,
  hooks: HookFnOrArray<E> | undefined,
  event: E,
  options?: HookTimeoutOptions,
  config?: HookConfig
): Promise<HookChainResult> {
  const normalized = normalizeHook(hooks);
  if (normalized.length === 0) return { result: { ...DEFAULT_HOOK_RESULT }, errors: [] };

  const timeoutMs = options?.timeoutMs ?? config?.timeout?.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const onTimeout = options?.onTimeout ?? config?.timeout?.onTimeout ?? 'warn';

  const reportError =
    config?.onHookError ??
    ((name: string, err: HookError) => {
      // Hook errors fall back to console.error when no onHookError handler is configured.
      // Users should configure HookConfig.onHookError or AgentConfig.logger for production.
      console.error(`[zero-agent-sdk] Hook "${name}" error:`, err.message);
    });

  const errors: HookError[] = [];
  const mergedResult: HookResult = { ...DEFAULT_HOOK_RESULT };

  for (let i = 0; i < normalized.length; i++) {
    const hook = normalized[i];
    try {
      const rawResult = hook(event);
      const result =
        rawResult instanceof Promise
          ? await withTimeout(rawResult, timeoutMs, hookName)
          : rawResult;

      const effective = result ?? DEFAULT_HOOK_RESULT;

      // Merge: first non-default field wins
      if (effective.continue === false) {
        mergedResult.continue = false;
        mergedResult.stopReason = effective.stopReason ?? mergedResult.stopReason;
        break; // Stop chain on continue: false
      }
      if (effective.updatedInput !== undefined && mergedResult.updatedInput === undefined) {
        mergedResult.updatedInput = effective.updatedInput;
      }
      if (effective.additionalContext && !mergedResult.additionalContext) {
        mergedResult.additionalContext = effective.additionalContext;
      }
      if (effective.stopReason && !mergedResult.stopReason) {
        mergedResult.stopReason = effective.stopReason;
      }
    } catch (rawError) {
      const cause = rawError instanceof Error ? rawError : new Error(String(rawError));
      const isTimeout = cause.message.includes('timed out after');
      const hookError = new HookError(
        `Hook "${hookName}" [${i}] failed: ${cause.message}`,
        hookName,
        i,
        cause
      );
      errors.push(hookError);
      reportError(hookName, hookError);

      // If the error is a timeout and the policy is 'throw', re-throw.
      if (isTimeout && onTimeout === 'throw') {
        throw hookError;
      }
      // Otherwise continue to next hook
    }
  }

  return { result: mergedResult, errors };
}

// ---------------------------------------------------------------------------
// Convenience runners — one per hook event type
// ---------------------------------------------------------------------------

export async function runPreToolUseHook(
  hooks: HookConfig | undefined,
  event: PreToolUseEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('preToolUse', hooks?.preToolUse, event, options, hooks);
}

export async function runPostToolUseHook(
  hooks: HookConfig | undefined,
  event: PostToolUseEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('postToolUse', hooks?.postToolUse, event, options, hooks);
}

export async function runPreQueryHook(
  hooks: HookConfig | undefined,
  event: PreQueryEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('preQuery', hooks?.preQuery, event, options, hooks);
}

export async function runPostQueryHook(
  hooks: HookConfig | undefined,
  event: PostQueryEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('postQuery', hooks?.postQuery, event, options, hooks);
}

export async function runErrorHook(
  hooks: HookConfig | undefined,
  event: ErrorHookEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('onError', hooks?.onError, event, options, hooks);
}

export async function runTurnStartHook(
  hooks: HookConfig | undefined,
  event: TurnStartHookEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('onTurnStart', hooks?.onTurnStart, event, options, hooks);
}

export async function runTurnEndHook(
  hooks: HookConfig | undefined,
  event: TurnEndHookEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('onTurnEnd', hooks?.onTurnEnd, event, options, hooks);
}

export async function runCompactHook(
  hooks: HookConfig | undefined,
  event: CompactHookEvent,
  options?: HookTimeoutOptions
): Promise<HookChainResult> {
  return runHookChain('onCompact', hooks?.onCompact, event, options, hooks);
}
