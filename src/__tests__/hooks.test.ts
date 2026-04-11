/**
 * Tests for hooks integration in the agent loop and tool orchestration.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentEvent } from '../core/events.js';
import {
  runCompactHook,
  runErrorHook,
  runPostToolUseHook,
  runPreToolUseHook,
  runTurnEndHook,
  runTurnStartHook,
} from '../hooks/runner.js';
import type { HookConfig } from '../hooks/types.js';
import { HookError } from '../hooks/types.js';
import { partitionToolCalls } from '../tools/orchestration.js';
import { buildSDKTool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// Hook runner tests
// ---------------------------------------------------------------------------

describe('Hook runner', () => {
  it('should run preToolUse hook and return result', async () => {
    const hook = vi.fn().mockResolvedValue({ continue: true });
    const hooks: HookConfig = { preToolUse: hook };

    const result = await runPreToolUseHook(hooks, {
      type: 'preToolUse',
      toolName: 'test',
      toolInput: { foo: 'bar' },
      toolUseId: 'id-1',
    });

    expect(hook).toHaveBeenCalledOnce();
    expect(result.result.continue).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should return default result when hook is undefined', async () => {
    const result = await runPreToolUseHook(undefined, {
      type: 'preToolUse',
      toolName: 'test',
      toolInput: {},
      toolUseId: 'id-1',
    });

    expect(result.result.continue).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should handle hook errors gracefully and report them', async () => {
    const hook = vi.fn().mockRejectedValue(new Error('hook failed'));
    const hooks: HookConfig = { onError: hook };

    const { result, errors } = await runErrorHook(hooks, {
      type: 'onError',
      error: new Error('test error'),
    });

    // Errors in hooks are swallowed — default result returned
    expect(result.continue).toBe(true);
    // But the error is collected
    expect(errors).toHaveLength(1);
    expect(errors[0].hookName).toBe('onError');
    expect(errors[0].index).toBe(0);
    expect(errors[0].cause.message).toBe('hook failed');
  });

  it('should run postToolUse hook with duration info', async () => {
    const hook = vi.fn().mockResolvedValue({ continue: true });
    const hooks: HookConfig = { postToolUse: hook };

    await runPostToolUseHook(hooks, {
      type: 'postToolUse',
      toolName: 'test',
      toolInput: {},
      toolUseId: 'id-1',
      toolResult: 'result',
      isError: false,
      durationMs: 42,
    });

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'test',
        durationMs: 42,
        isError: false,
      })
    );
  });

  it('should run onTurnStart hook', async () => {
    const hook = vi.fn().mockResolvedValue({ continue: true });
    const hooks: HookConfig = { onTurnStart: hook };

    const result = await runTurnStartHook(hooks, {
      type: 'onTurnStart',
      turnNumber: 1,
    });

    expect(hook).toHaveBeenCalledOnce();
    expect(result.result.continue).toBe(true);
  });

  it('should run onTurnEnd hook', async () => {
    const hook = vi.fn().mockResolvedValue({ continue: true });
    const hooks: HookConfig = { onTurnEnd: hook };

    await runTurnEndHook(hooks, {
      type: 'onTurnEnd',
      turnNumber: 1,
      stopReason: 'tool_use',
    });

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        turnNumber: 1,
        stopReason: 'tool_use',
      })
    );
  });

  it('should run onCompact hook', async () => {
    const hook = vi.fn().mockResolvedValue({ continue: true });
    const hooks: HookConfig = { onCompact: hook };

    await runCompactHook(hooks, {
      type: 'onCompact',
      summary: 'Compacted 10 messages',
      tokensBefore: 1000,
      tokensAfter: 500,
    });

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        tokensBefore: 1000,
        tokensAfter: 500,
      })
    );
  });

  it('preToolUse hook can block tool execution', async () => {
    const hook = vi.fn().mockResolvedValue({
      continue: false,
      stopReason: 'blocked_by_policy',
    });
    const hooks: HookConfig = { preToolUse: hook };

    const result = await runPreToolUseHook(hooks, {
      type: 'preToolUse',
      toolName: 'dangerous_tool',
      toolInput: {},
      toolUseId: 'id-1',
    });

    expect(result.result.continue).toBe(false);
    expect(result.result.stopReason).toBe('blocked_by_policy');
  });

  it('preToolUse hook can modify input', async () => {
    const hook = vi.fn().mockResolvedValue({
      continue: true,
      updatedInput: { sanitized: true },
    });
    const hooks: HookConfig = { preToolUse: hook };

    const result = await runPreToolUseHook(hooks, {
      type: 'preToolUse',
      toolName: 'test',
      toolInput: { original: true },
      toolUseId: 'id-1',
    });

    expect(result.result.updatedInput).toEqual({ sanitized: true });
  });
});
