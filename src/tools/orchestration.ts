/**
 * Tool orchestration — partitions tool calls into concurrent/serial batches.
 * Supports pre/postToolUse hooks, permission request events, and
 * newMessages/contextModifier from tool results.
 *
 * contextModifier handling:
 * - Serial batches: contextModifier is applied immediately after each tool.
 * - Concurrent batches: contextModifiers are queued and applied in original
 *   request order after the entire batch completes.
 */

import { runPostToolUseHook, runPreToolUseHook } from '../hooks/runner.js';
import type { HookConfig } from '../hooks/types.js';
import { enforceResultLimit } from './result-limiter.js';
import type { SDKTool, SDKToolResult, ToolExecutionContext, ToolProgressFn } from './types.js';
import { findToolByName } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolUseRequest {
  id: string;
  name: string;
  input: unknown;
  /** Set when streaming JSON parse failed — tool should return error instead of executing */
  _parseError?: string;
}

export interface ToolExecutionResult {
  toolUseId: string;
  toolName: string;
  result: SDKToolResult;
  isError: boolean;
}

export interface ToolOrchestrationUpdate {
  /** The tool execution result (present for each individual tool completion). */
  executionResult?: ToolExecutionResult;
  /** The current execution context (always reflects the latest state). */
  newContext: ToolExecutionContext;
}

export interface ToolBatch {
  isConcurrencySafe: boolean;
  requests: ToolUseRequest[];
}

// ---------------------------------------------------------------------------
// Core Orchestration
// ---------------------------------------------------------------------------

/**
 * Execute a batch of tool calls, automatically partitioning into
 * concurrent-safe and serial batches.
 *
 * Yields `ToolOrchestrationUpdate` containing both the per-tool result and
 * the updated execution context. The caller should always use the latest
 * `newContext` from the yielded updates.
 *
 * ## Two-layer permission model
 *
 * Permission checks happen at two levels:
 *
 * 1. **Tool-level** (`SDKTool.checkPermissions`): Each tool implements its own
 *    permission logic, returning `allow`, `deny`, or `ask`. This runs inside
 *    `executeSingleTool` before the tool's `call()` method.
 *
 * 2. **Agent-level** (`onPermissionRequest` callback): When a tool-level check
 *    returns `ask`, the orchestrator delegates to this callback (provided by
 *    the agent loop in `query.ts`). The agent loop uses `checkToolPermission`
 *    from `permissions/checker.ts` to evaluate the configured permission mode
 *    and handler. If the decision is still `ask`, a `permission_request` event
 *    is emitted to the host for interactive approval.
 *
 * This separation allows tools to express their own safety semantics while
 * letting the agent-level policy have the final say.
 */
export async function* runTools(
  toolUseRequests: ToolUseRequest[],
  context: ToolExecutionContext,
  options: {
    onPermissionRequest?: (
      tool: string,
      input: unknown
    ) => Promise<boolean | { allow: boolean; updatedInput?: unknown }>;
    onProgress?: ToolProgressFn;
    maxConcurrency?: number;
    hooks?: HookConfig;
  } = {}
): AsyncGenerator<ToolOrchestrationUpdate> {
  const maxConcurrency = options.maxConcurrency ?? 10;
  let currentContext = context;

  for (const batch of partitionToolCalls(toolUseRequests, currentContext)) {
    if (batch.isConcurrencySafe) {
      // ---------------------------------------------------------------
      // Concurrent batch: queue contextModifiers, apply after batch ends
      // ---------------------------------------------------------------
      const queuedContextModifiers: Record<
        string,
        ((ctx: ToolExecutionContext) => ToolExecutionContext)[]
      > = {};

      for await (const result of runToolsConcurrently(
        batch.requests,
        currentContext,
        options,
        maxConcurrency
      )) {
        // Queue contextModifier instead of applying immediately
        if (result.result.contextModifier) {
          const modifiers = queuedContextModifiers[result.toolUseId] ?? [];
          modifiers.push(result.result.contextModifier);
          queuedContextModifiers[result.toolUseId] = modifiers;
        }

        yield {
          executionResult: result,
          newContext: currentContext,
        };
      }

      // Apply queued contextModifiers in original request order
      for (const request of batch.requests) {
        const modifiers = queuedContextModifiers[request.id];
        if (!modifiers) continue;
        for (const modifier of modifiers) {
          currentContext = modifier(currentContext);
        }
      }

      // Yield a context-only update after applying all modifiers
      yield { newContext: currentContext };
    } else {
      // ---------------------------------------------------------------
      // Serial batch: apply contextModifier immediately after each tool
      // ---------------------------------------------------------------
      for await (const result of runToolsSerially(batch.requests, currentContext, options)) {
        if (result.result.contextModifier) {
          currentContext = result.result.contextModifier(currentContext);
        }

        yield {
          executionResult: result,
          newContext: currentContext,
        };
      }
    }
  }
}

/**
 * Partition tool calls into batches: consecutive concurrency-safe tools
 * are grouped together; non-safe tools run individually.
 */
export function partitionToolCalls(
  requests: ToolUseRequest[],
  context: ToolExecutionContext
): ToolBatch[] {
  return requests.reduce<ToolBatch[]>((acc, request) => {
    const tool = findToolByName(context.tools, request.name);
    let isConcurrencySafe = false;

    if (tool) {
      try {
        const parsed = tool.inputSchema.safeParse(request.input);
        if (parsed.success) {
          isConcurrencySafe = Boolean(tool.isConcurrencySafe(parsed.data));
        }
      } catch {
        // If isConcurrencySafe throws (e.g., due to parse failure),
        // treat as not concurrency-safe to be conservative
      }
    }

    const lastBatch = acc[acc.length - 1];
    if (isConcurrencySafe && lastBatch?.isConcurrencySafe) {
      lastBatch.requests.push(request);
    } else {
      acc.push({ isConcurrencySafe, requests: [request] });
    }

    return acc;
  }, []);
}

// ---------------------------------------------------------------------------
// Serial Execution
// ---------------------------------------------------------------------------

async function* runToolsSerially(
  requests: ToolUseRequest[],
  context: ToolExecutionContext,
  options: {
    onPermissionRequest?: (
      tool: string,
      input: unknown
    ) => Promise<boolean | { allow: boolean; updatedInput?: unknown }>;
    onProgress?: ToolProgressFn;
    hooks?: HookConfig;
  }
): AsyncGenerator<ToolExecutionResult> {
  for (const request of requests) {
    yield await executeSingleTool(request, context, options);
  }
}

// ---------------------------------------------------------------------------
// Concurrent Execution
// ---------------------------------------------------------------------------

async function* runToolsConcurrently(
  requests: ToolUseRequest[],
  context: ToolExecutionContext,
  options: {
    onPermissionRequest?: (
      tool: string,
      input: unknown
    ) => Promise<boolean | { allow: boolean; updatedInput?: unknown }>;
    onProgress?: ToolProgressFn;
    hooks?: HookConfig;
  },
  maxConcurrency: number
): AsyncGenerator<ToolExecutionResult> {
  // Process in chunks of maxConcurrency
  for (let i = 0; i < requests.length; i += maxConcurrency) {
    const chunk = requests.slice(i, i + maxConcurrency);
    const results = await Promise.all(chunk.map((req) => executeSingleTool(req, context, options)));
    for (const result of results) {
      yield result;
    }
  }
}

// ---------------------------------------------------------------------------
// Single Tool Execution
// ---------------------------------------------------------------------------

/**
 * Execute a single tool with full lifecycle:
 * 1. Look up tool by name
 * 2. Validate input via Zod schema
 * 3. Run `preToolUse` hook (may modify input or block execution)
 * 4. Run custom `validateInput` if defined
 * 5. Run tool-level `checkPermissions` (layer 1)
 * 6. If permission is `ask`, delegate to `onPermissionRequest` callback (layer 2)
 * 7. Execute `tool.call()`
 * 8. Run `postToolUse` hook
 *
 * Layer 1 (tool-level) permissions are defined by each SDKTool implementation.
 * Layer 2 (agent-level) permissions are resolved by the agent loop via the
 * `onPermissionRequest` callback, which uses the configured PermissionMode
 * and PermissionHandler to decide, potentially emitting a `permission_request`
 * event for interactive host approval.
 */
async function executeSingleTool(
  request: ToolUseRequest,
  context: ToolExecutionContext,
  options: {
    onPermissionRequest?: (
      tool: string,
      input: unknown
    ) => Promise<boolean | { allow: boolean; updatedInput?: unknown }>;
    onProgress?: ToolProgressFn;
    hooks?: HookConfig;
  }
): Promise<ToolExecutionResult> {
  // Check for JSON parse error from streaming — return error instead of
  // executing with empty/invalid input which could cause damage
  if (request._parseError) {
    return {
      toolUseId: request.id,
      toolName: request.name,
      result: { data: `Error: ${request._parseError}` },
      isError: true,
    };
  }

  const tool = findToolByName(context.tools, request.name);

  if (!tool) {
    return {
      toolUseId: request.id,
      toolName: request.name,
      result: { data: `Error: Unknown tool "${request.name}"` },
      isError: true,
    };
  }

  // Validate input
  const parsed = tool.inputSchema.safeParse(request.input);
  if (!parsed.success) {
    return {
      toolUseId: request.id,
      toolName: request.name,
      result: { data: `Error: Invalid input for tool "${request.name}": ${parsed.error.message}` },
      isError: true,
    };
  }

  // Check if tool is enabled
  if (!tool.isEnabled()) {
    return {
      toolUseId: request.id,
      toolName: request.name,
      result: { data: `Error: Tool "${request.name}" is not enabled` },
      isError: true,
    };
  }

  // --- preToolUse hook ---
  let effectiveInput: any = parsed.data;
  let hookNewMessages: Array<{ role: 'user' | 'assistant'; content: unknown[] }> | undefined;
  if (options.hooks?.preToolUse) {
    const { result: hookResult } = await runPreToolUseHook(options.hooks, {
      type: 'preToolUse',
      toolName: request.name,
      toolInput: effectiveInput,
      toolUseId: request.id,
    });
    if (hookResult.continue === false) {
      return {
        toolUseId: request.id,
        toolName: request.name,
        result: {
          data: `Tool execution blocked by hook: ${hookResult.stopReason ?? 'preToolUse hook'}`,
        },
        isError: true,
      };
    }
    // Allow hook to modify input
    if (hookResult.updatedInput !== undefined) {
      effectiveInput = hookResult.updatedInput;
    }
    // Inject additionalContext from hook as newMessages
    if (hookResult.additionalContext) {
      hookNewMessages = [
        { role: 'user', content: [{ type: 'text', text: hookResult.additionalContext }] },
      ];
    }
  }

  // Validate input (custom validation beyond schema)
  if (tool.validateInput) {
    const validation = await tool.validateInput(effectiveInput, context);
    if (!validation.result) {
      return {
        toolUseId: request.id,
        toolName: request.name,
        result: { data: `Error: ${validation.message}` },
        isError: true,
      };
    }
  }

  // Check permissions
  const permResult = await tool.checkPermissions(effectiveInput, context);
  if (permResult.behavior === 'deny') {
    return {
      toolUseId: request.id,
      toolName: request.name,
      result: { data: `Permission denied: ${permResult.message}` },
      isError: true,
    };
  }

  // Apply updatedInput from permission check (e.g. path normalization)
  if (permResult.behavior === 'allow' && permResult.updatedInput !== undefined) {
    effectiveInput = permResult.updatedInput;
  }

  if (permResult.behavior === 'ask') {
    if (options.onPermissionRequest) {
      const permResponse = await options.onPermissionRequest(request.name, effectiveInput);
      // Handle enhanced response format { allow, updatedInput }
      const allowed = typeof permResponse === 'boolean' ? permResponse : permResponse.allow;
      if (!allowed) {
        return {
          toolUseId: request.id,
          toolName: request.name,
          result: { data: 'Permission denied by user' },
          isError: true,
        };
      }
      // Apply updatedInput from permission response (e.g. AskUser answers)
      if (typeof permResponse === 'object' && permResponse.updatedInput !== undefined) {
        effectiveInput = permResponse.updatedInput;
      }
    } else {
      // No permission handler configured — safe default is to deny
      return {
        toolUseId: request.id,
        toolName: request.name,
        result: { data: 'Permission denied: no permission handler configured' },
        isError: true,
      };
    }
  }

  // Execute tool
  const startTime = Date.now();
  try {
    const result = await tool.call(effectiveInput, context, options.onProgress);
    const durationMs = Date.now() - startTime;

    // Enforce result size limit — use preserveStructure to keep structured
    // data intact for mapToolResult() which may need the original shape
    const limited = enforceResultLimit(result.data, request.name, tool.maxResultSizeChars, {
      preserveStructure: true,
    });
    result.data = limited.data as typeof result.data;

    // Merge additionalContext from preToolUse hook into newMessages
    if (hookNewMessages) {
      result.newMessages = [...(result.newMessages ?? []), ...hookNewMessages];
    }

    // --- postToolUse hook ---
    await runPostToolUseHook(options.hooks, {
      type: 'postToolUse',
      toolName: request.name,
      toolInput: effectiveInput,
      toolUseId: request.id,
      toolResult: result.data,
      isError: false,
      durationMs,
    });

    return {
      toolUseId: request.id,
      toolName: request.name,
      result,
      isError: false,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);

    // --- postToolUse hook ---
    await runPostToolUseHook(options.hooks, {
      type: 'postToolUse',
      toolName: request.name,
      toolInput: effectiveInput,
      toolUseId: request.id,
      toolResult: message,
      isError: true,
      durationMs,
    });

    return {
      toolUseId: request.id,
      toolName: request.name,
      result: { data: `Error executing tool "${request.name}": ${message}` },
      isError: true,
    };
  }
}
