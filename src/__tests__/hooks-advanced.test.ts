/**
 * Advanced tests for the hook system — array support, timeouts, structured errors,
 * error isolation, chain merging, continue: false, and onHookError callback.
 */

import { describe, expect, it, vi } from 'vitest';
import { runHookChain, runPreQueryHook, runPreToolUseHook } from '../hooks/runner.js';
import type { HookConfig, HookResult, PreQueryEvent, PreToolUseEvent } from '../hooks/types.js';
import { HookError } from '../hooks/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePreToolUseEvent(overrides?: Partial<PreToolUseEvent>): PreToolUseEvent {
  return {
    type: 'preToolUse',
    toolName: 'testTool',
    toolInput: { key: 'value' },
    toolUseId: 'tu-001',
    ...overrides,
  };
}

function makePreQueryEvent(overrides?: Partial<PreQueryEvent>): PreQueryEvent {
  return {
    type: 'preQuery',
    messageCount: 5,
    turnNumber: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Array support
// ---------------------------------------------------------------------------

describe('Hook array support', () => {
  it('should call all functions in an array sequentially', async () => {
    const callOrder: number[] = [];

    const hookA = vi.fn(async () => {
      callOrder.push(1);
      return { continue: true };
    });
    const hookB = vi.fn(async () => {
      callOrder.push(2);
      return { continue: true };
    });
    const hookC = vi.fn(async () => {
      callOrder.push(3);
      return { continue: true };
    });

    const config: HookConfig = {
      preToolUse: [hookA, hookB, hookC],
    };

    const { result, errors } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(hookA).toHaveBeenCalledOnce();
    expect(hookB).toHaveBeenCalledOnce();
    expect(hookC).toHaveBeenCalledOnce();
    expect(callOrder).toEqual([1, 2, 3]);
    expect(result.continue).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('should work with a single function (not wrapped in array)', async () => {
    const hook = vi.fn().mockResolvedValue({ continue: true });
    const config: HookConfig = { preQuery: hook };

    const { result } = await runPreQueryHook(config, makePreQueryEvent());

    expect(hook).toHaveBeenCalledOnce();
    expect(result.continue).toBe(true);
  });

  it('should return default result when hook array is empty or undefined', async () => {
    const { result, errors } = await runHookChain('preQuery', undefined, makePreQueryEvent());

    expect(result.continue).toBe(true);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe('Hook timeout', () => {
  it('should catch a hook that exceeds the timeout (warn mode)', async () => {
    // Use a very short real timeout to avoid needing fake timers
    const slowHook = vi.fn(
      () => new Promise<HookResult>((resolve) => setTimeout(() => resolve({ continue: true }), 500))
    );

    const errorHandler = vi.fn();
    const config: HookConfig = {
      preToolUse: slowHook,
      timeout: { timeoutMs: 10, onTimeout: 'warn' },
      onHookError: errorHandler,
    };

    const { result, errors } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(HookError);
    expect(errors[0]!.cause.message).toContain('timed out after');
    expect(errorHandler).toHaveBeenCalledOnce();
    // In warn mode, continues with default result
    expect(result.continue).toBe(true);
  });

  it('should throw when timeout mode is "throw"', async () => {
    const slowHook = vi.fn(
      () => new Promise<HookResult>((resolve) => setTimeout(() => resolve({ continue: true }), 500))
    );

    const config: HookConfig = {
      preToolUse: slowHook,
      timeout: { timeoutMs: 10, onTimeout: 'throw' },
      onHookError: vi.fn(),
    };

    await expect(runPreToolUseHook(config, makePreToolUseEvent())).rejects.toThrow(HookError);
  });
});

// ---------------------------------------------------------------------------
// Structured errors — HookError
// ---------------------------------------------------------------------------

describe('HookError structure', () => {
  it('should wrap original error with hookName and index', async () => {
    const originalError = new Error('something broke');
    const failingHook = vi.fn(() => {
      throw originalError;
    });

    const errorHandler = vi.fn();
    const config: HookConfig = {
      preToolUse: [vi.fn().mockReturnValue({ continue: true }), failingHook],
      onHookError: errorHandler,
    };

    const { errors } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(errors).toHaveLength(1);
    const hookError = errors[0]!;
    expect(hookError).toBeInstanceOf(HookError);
    expect(hookError.name).toBe('HookError');
    expect(hookError.hookName).toBe('preToolUse');
    expect(hookError.index).toBe(1);
    expect(hookError.cause).toBe(originalError);
    expect(hookError.message).toContain('something broke');
  });

  it('should wrap non-Error throws into an Error cause', async () => {
    const failingHook = vi.fn(() => {
      throw 'string error'; // eslint-disable-line no-throw-literal
    });

    const errorHandler = vi.fn();
    const config: HookConfig = {
      preToolUse: failingHook,
      onHookError: errorHandler,
    };

    const { errors } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(errors).toHaveLength(1);
    expect(errors[0]!.cause).toBeInstanceOf(Error);
    expect(errors[0]!.cause.message).toBe('string error');
  });
});

// ---------------------------------------------------------------------------
// Error isolation
// ---------------------------------------------------------------------------

describe('Hook error isolation', () => {
  it('should continue running subsequent hooks after one fails', async () => {
    const callOrder: string[] = [];

    const hookA = vi.fn(async () => {
      callOrder.push('A');
      return { continue: true };
    });
    const hookB = vi.fn(async () => {
      callOrder.push('B');
      throw new Error('hook B failed');
    });
    const hookC = vi.fn(async () => {
      callOrder.push('C');
      return { continue: true, additionalContext: 'from C' };
    });

    const errorHandler = vi.fn();
    const config: HookConfig = {
      preToolUse: [hookA, hookB, hookC],
      onHookError: errorHandler,
    };

    const { result, errors } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(callOrder).toEqual(['A', 'B', 'C']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.index).toBe(1);
    // Hook C's result should still be merged
    expect(result.additionalContext).toBe('from C');
    expect(result.continue).toBe(true);
  });

  it('should collect multiple errors from multiple failing hooks', async () => {
    const hookA = vi.fn(() => {
      throw new Error('fail A');
    });
    const hookB = vi.fn(() => {
      throw new Error('fail B');
    });
    const hookC = vi.fn(() => {
      throw new Error('fail C');
    });

    const errorHandler = vi.fn();
    const config: HookConfig = {
      preToolUse: [hookA, hookB, hookC],
      onHookError: errorHandler,
    };

    const { errors } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(errors).toHaveLength(3);
    expect(errors[0]!.index).toBe(0);
    expect(errors[1]!.index).toBe(1);
    expect(errors[2]!.index).toBe(2);
    expect(errorHandler).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Hook chain merging — first non-default value wins
// ---------------------------------------------------------------------------

describe('Hook chain merging', () => {
  it('should use the first non-undefined updatedInput', async () => {
    const hookA = vi.fn().mockReturnValue({ continue: true, updatedInput: { a: 1 } });
    const hookB = vi.fn().mockReturnValue({ continue: true, updatedInput: { b: 2 } });

    const config: HookConfig = {
      preToolUse: [hookA, hookB],
    };

    const { result } = await runPreToolUseHook(config, makePreToolUseEvent());

    // First non-default value wins
    expect(result.updatedInput).toEqual({ a: 1 });
  });

  it('should use the first non-empty additionalContext', async () => {
    const hookA = vi.fn().mockReturnValue({ continue: true, additionalContext: 'context A' });
    const hookB = vi.fn().mockReturnValue({ continue: true, additionalContext: 'context B' });

    const config: HookConfig = {
      preToolUse: [hookA, hookB],
    };

    const { result } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(result.additionalContext).toBe('context A');
  });

  it('should use the first non-empty stopReason', async () => {
    const hookA = vi.fn().mockReturnValue({ continue: true });
    const hookB = vi.fn().mockReturnValue({ continue: true, stopReason: 'reason B' });
    const hookC = vi.fn().mockReturnValue({ continue: true, stopReason: 'reason C' });

    const config: HookConfig = {
      preToolUse: [hookA, hookB, hookC],
    };

    const { result } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(result.stopReason).toBe('reason B');
  });

  it('should allow later hooks to set fields when earlier hooks return defaults', async () => {
    const hookA = vi.fn().mockReturnValue({ continue: true });
    const hookB = vi.fn().mockReturnValue({
      continue: true,
      updatedInput: { late: true },
      additionalContext: 'late context',
    });

    const config: HookConfig = {
      preToolUse: [hookA, hookB],
    };

    const { result } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(result.updatedInput).toEqual({ late: true });
    expect(result.additionalContext).toBe('late context');
  });

  it('should treat null return from hook as default result', async () => {
    const hookA = vi.fn().mockReturnValue(null);
    const hookB = vi.fn().mockReturnValue({ continue: true, additionalContext: 'from B' });

    const config: HookConfig = {
      preToolUse: [hookA, hookB],
    };

    const { result } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(result.continue).toBe(true);
    expect(result.additionalContext).toBe('from B');
  });
});

// ---------------------------------------------------------------------------
// continue: false — stops the chain
// ---------------------------------------------------------------------------

describe('Hook continue: false', () => {
  it('should stop the chain immediately when continue is false', async () => {
    const hookA = vi.fn().mockReturnValue({ continue: false, stopReason: 'blocked' });
    const hookB = vi.fn().mockReturnValue({ continue: true });

    const config: HookConfig = {
      preToolUse: [hookA, hookB],
    };

    const { result } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(hookA).toHaveBeenCalledOnce();
    expect(hookB).not.toHaveBeenCalled();
    expect(result.continue).toBe(false);
    expect(result.stopReason).toBe('blocked');
  });

  it('should stop mid-chain and preserve earlier merged values', async () => {
    const hookA = vi.fn().mockReturnValue({
      continue: true,
      updatedInput: { patched: true },
    });
    const hookB = vi.fn().mockReturnValue({ continue: false, stopReason: 'denied' });
    const hookC = vi.fn().mockReturnValue({ continue: true });

    const config: HookConfig = {
      preToolUse: [hookA, hookB, hookC],
    };

    const { result } = await runPreToolUseHook(config, makePreToolUseEvent());

    expect(hookC).not.toHaveBeenCalled();
    expect(result.continue).toBe(false);
    expect(result.stopReason).toBe('denied');
    expect(result.updatedInput).toEqual({ patched: true });
  });
});

// ---------------------------------------------------------------------------
// onHookError callback
// ---------------------------------------------------------------------------

describe('onHookError callback', () => {
  it('should receive HookError instances with correct metadata', async () => {
    const errorHandler = vi.fn();

    const config: HookConfig = {
      preToolUse: [
        vi.fn(() => {
          throw new Error('boom');
        }),
      ],
      onHookError: errorHandler,
    };

    await runPreToolUseHook(config, makePreToolUseEvent());

    expect(errorHandler).toHaveBeenCalledOnce();
    const [hookName, hookError] = errorHandler.mock.calls[0]!;
    expect(hookName).toBe('preToolUse');
    expect(hookError).toBeInstanceOf(HookError);
    expect(hookError.hookName).toBe('preToolUse');
    expect(hookError.index).toBe(0);
    expect(hookError.cause.message).toBe('boom');
  });

  it('should fall back to console.error when no custom handler is provided', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config: HookConfig = {
      preToolUse: vi.fn(() => {
        throw new Error('unhandled');
      }),
    };

    await runPreToolUseHook(config, makePreToolUseEvent());

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0]![0]).toContain('[zero-agent-sdk]');

    consoleSpy.mockRestore();
  });

  it('should call onHookError for each failing hook in the chain', async () => {
    const errorHandler = vi.fn();

    const config: HookConfig = {
      preToolUse: [
        vi.fn(() => {
          throw new Error('err-0');
        }),
        vi.fn().mockReturnValue({ continue: true }),
        vi.fn(() => {
          throw new Error('err-2');
        }),
      ],
      onHookError: errorHandler,
    };

    await runPreToolUseHook(config, makePreToolUseEvent());

    expect(errorHandler).toHaveBeenCalledTimes(2);
    expect(errorHandler.mock.calls[0]![1].index).toBe(0);
    expect(errorHandler.mock.calls[1]![1].index).toBe(2);
  });
});
