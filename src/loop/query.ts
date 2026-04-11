/**
 * Agent loop — the core query/tool execution cycle.
 * Enhanced with auto-compaction, API error retry, improved tool result mapping,
 * full hook integration, state management, newMessages/contextModifier support,
 * and permission_request events.
 */

import { z } from 'zod';
import {
  type AutoCompactConfig,
  autoCompactIfNeeded,
  type CompactCircuitState,
  createCompactCircuitState,
  recordCompactFailure,
  recordCompactSuccess,
  truncateHeadForPTLRetry,
} from '../context/compact.js';
import type { UsageCallbackEvent } from '../core/agent.js';
import { BudgetExceededError, ProviderError, AbortError as SDKAbortError } from '../core/errors.js';
import type { AgentEvent } from '../core/events.js';
import type { Logger, ThinkingConfig, Usage } from '../core/types.js';
import {
  runCompactHook,
  runErrorHook,
  runPostQueryHook,
  runPostToolUseHook,
  runPreQueryHook,
  runPreToolUseHook,
  runTurnEndHook,
  runTurnStartHook,
} from '../hooks/runner.js';
import type { HookConfig } from '../hooks/types.js';
import { checkToolPermission } from '../permissions/checker.js';
import type { DenialLimits, DenialTrackingState } from '../permissions/rules.js';
import type { PermissionHandler, PermissionMode, PermissionRule } from '../permissions/types.js';
import type {
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderStreamEvent,
  ProviderToolResultBlock,
  ProviderToolSchema,
  ProviderToolUseBlock,
  ProviderUsage,
  SystemPromptBlock,
} from '../providers/types.js';
import { mapProviderError } from '../providers/utils/error-mapper.js';
import { runTools, type ToolUseRequest } from '../tools/orchestration.js';
import { enforceContentLimit, enforceMultimodalLimit } from '../tools/result-limiter.js';
import type { AgentSessionState, SDKTool, ToolExecutionContext } from '../tools/types.js';
import { pruneReadFileState } from '../tools/types.js';
import type { Tracer } from '../tracing/tracer.js';
import {
  abortableSleep,
  createLinkedAbortController,
  isAbortError,
  throwIfAborted,
} from '../utils/abort.js';
import {
  createMissingToolResults,
  createToolResultMessage,
  createUserMessage,
  extractText,
  extractToolUseBlocks,
  normalizeMessageOrder,
} from '../utils/messages.js';
import {
  addUsage,
  emptyUsage,
  estimateMessagesTokenCount,
  providerUsageToUsage,
} from '../utils/tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentLoopConfig {
  provider: ModelProvider;
  model: string;
  tools: SDKTool[];
  systemPrompt?: string | SystemPromptBlock[];
  thinkingConfig?: ThinkingConfig;
  maxTurns: number;
  maxBudgetUsd?: number;
  /** Maximum total tokens (input + output) before stopping */
  maxTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  permissionMode: PermissionMode;
  permissionHandler?: PermissionHandler;
  /** Static permission rules evaluated before the handler */
  permissionRules?: PermissionRule[];
  /** Denial tracking limits */
  denialLimits?: DenialLimits;
  /** Tracer instance for structured tracing */
  tracer?: Tracer;
  hooks?: HookConfig;
  cwd: string;
  signal?: AbortSignal;
  /** Context window size in tokens (for auto-compact). If set, enables auto-compaction. */
  contextWindow?: number;
  /** Auto-compact threshold ratio (0-1, default: 0.8) */
  compactThreshold?: number;
  /** Session ID (for usage callbacks) */
  sessionId?: string;
  /** Usage callback */
  onUsage?: (event: UsageCallbackEvent) => void | Promise<void>;
  /** Event emitter for pushing events to the host (e.g. permission_request) */
  emitEvent?: (event: AgentEvent) => void;

  // --- Session-scoped state (persists across send() calls) ---

  /** Externally-managed session state — survives across send() calls within a session. */
  sessionState?: AgentSessionState;
  /** Externally-managed read-file staleness cache — survives across send() calls. */
  readFileState?: Map<string, import('../tools/types.js').ReadFileStateEntry>;
  /** Callback invoked when tool execution changes the working directory. */
  onCwdChange?: (newCwd: string) => void;

  /** Workspace root directories for file access boundary enforcement */
  workspaceRoots?: string[];

  /** Whether to enforce workspace boundary (default: false) */
  enforceWorkspaceBoundary?: boolean;

  /** Query source identifier for selective retry (e.g. 'foreground', 'background') */
  querySource?: string;

  /** Structured logger for observability */
  logger?: Logger;

  /** Fallback model when primary model is overloaded */
  fallbackModel?: string;

  /** Max consecutive 529s before switching to fallback (default: 3) */
  maxConsecutive529s?: number;

  /** Permission request timeout in milliseconds (default: 30000) */
  permissionTimeoutMs?: number;

  /** Callback invoked when session state changes */
  onSessionStateChange?: (state: AgentSessionState) => void;
}

// ---------------------------------------------------------------------------
// BlockBuilder — typed accumulator for streaming content blocks
// ---------------------------------------------------------------------------

interface BlockBuilder {
  type: 'text' | 'thinking' | 'tool_use';
  // text block
  text?: string;
  // thinking block
  thinking?: string;
  // tool_use block
  id?: string;
  name?: string;
  input?: unknown;
  /** Accumulates partial JSON during streaming */
  _jsonAccumulator?: string;
  /** Set when JSON.parse fails — tool execution will return this error */
  _parseError?: string;
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

const MAX_RETRIES = 8;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isRetryableError(error: unknown, querySource?: string): boolean {
  // Prefer structured ProviderError status codes
  if (error instanceof ProviderError && error.statusCode !== undefined) {
    if (error.statusCode === 529 && querySource === 'background') return false;
    if (RETRYABLE_STATUS_CODES.has(error.statusCode)) return true;
  }

  if (error instanceof Error) {
    // Check for status property on error objects (structured check)
    if ('status' in error) {
      const status = (error as { status: number }).status;
      // Background queries should not retry 529 to avoid capacity cascade amplification
      if (status === 529 && querySource === 'background') return false;
      if (RETRYABLE_STATUS_CODES.has(status)) return true;
    }

    // Network-layer retryable errors
    if ('code' in error) {
      const code = (error as { code: string }).code;
      if (RETRYABLE_NETWORK_CODES.has(code)) return true;
    }

    // Fallback: string matching for unstructured errors
    const msg = error.message.toLowerCase();
    if (
      msg.includes('overloaded') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests')
    ) {
      return true;
    }
    // Check for HTTP status codes in the error message
    const statusMatch = msg.match(/status[:\s]*(\d{3})/);
    if (statusMatch && RETRYABLE_STATUS_CODES.has(parseInt(statusMatch[1]!, 10))) {
      return true;
    }
  }
  // Check for status property on non-Error objects
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    if (status === 529 && querySource === 'background') return false;
    if (RETRYABLE_STATUS_CODES.has(status)) return true;
  }
  return false;
}

function isPromptTooLongError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('prompt_too_long') ||
      msg.includes('prompt is too long') ||
      msg.includes('context_length_exceeded') ||
      msg.includes('maximum context length')
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Turn finalization helper
// ---------------------------------------------------------------------------

async function* finalizeTurn(
  config: AgentLoopConfig,
  turnNumber: number,
  stopReason: string,
  usage: Usage
): AsyncGenerator<AgentEvent> {
  await runTurnEndHook(config.hooks, { type: 'onTurnEnd', turnNumber, stopReason });
  yield { type: 'turn_end', stopReason, usage };
}

// ---------------------------------------------------------------------------
// Agent Loop
// ---------------------------------------------------------------------------

/**
 * Run the agent loop: query → tool calls → results → query again.
 * Yields AgentEvent for each step.
 *
 * Features:
 * - Streaming from provider
 * - Tool execution with batching (concurrent/serial)
 * - Auto-compaction when context approaches limit
 * - API error retry with exponential backoff
 * - Budget enforcement (cost + turns)
 * - Full hook integration (all 8 hooks)
 * - State management (getState/setState)
 * - newMessages / contextModifier from tool results
 * - permission_request events
 * - Usage callback
 */
export async function* agentLoop(
  messages: ProviderMessage[],
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  const { provider, model, tools, maxTurns, signal } = config;
  const logger = config.logger;
  const abortController = createLinkedAbortController(signal);
  let cumulativeUsage = emptyUsage();
  let turnNumber = 0;
  let compactCircuit: CompactCircuitState = createCompactCircuitState();
  const denialTracking: DenialTrackingState = { consecutiveDenials: 0, totalDenials: 0 };

  // Model fallback tracking
  let currentModel = model;
  let consecutive529s = 0;

  // Diminishing returns detection — track output tokens per turn
  const outputTokenHistory: number[] = [];
  const DIMINISHING_THRESHOLD = 500; // tokens
  const DIMINISHING_WINDOW = 3; // consecutive turns

  // Tracer — create main loop span if tracing is enabled
  const tracer = config.tracer;
  const mainSpanId =
    tracer?.span('agentLoop', {
      category: 'agent',
      attributes: { model, maxTurns },
    }) ?? '';

  // Build tool schemas for the provider (pre-filter denied tools)
  const toolSchemas = await buildToolSchemas(tools, config.permissionRules);

  // Session state — use externally-managed state if provided (persists across send() calls),
  // otherwise create a loop-local state (single run() use-case).
  let sessionState: AgentSessionState = config.sessionState ?? {};
  const readFileState: Map<string, import('../tools/types.js').ReadFileStateEntry> =
    config.readFileState ?? new Map();

  // Track current working directory — may change via tool contextModifier (e.g. Bash cd)
  let currentCwd = config.cwd;

  // Build execution context
  let execContext: ToolExecutionContext = {
    cwd: currentCwd,
    abortSignal: abortController.signal,
    tools,
    messages: [],
    model: currentModel,
    debug: false,
    readFileState,
    workspaceRoots: config.workspaceRoots ?? [currentCwd],
    enforceWorkspaceBoundary: config.enforceWorkspaceBoundary ?? false,
    getState: () => ({ ...sessionState }),
    setState: (updater) => {
      sessionState = updater(sessionState);
      // Notify externally-managed state via callback (non-mutating)
      if (config.onSessionStateChange) {
        config.onSessionStateChange(sessionState);
      } else if (config.sessionState) {
        // Fallback: write back to externally-managed state if provided.
        // Use atomic replacement to avoid race conditions from interleaved
        // delete-then-assign operations.
        const replacement = { ...sessionState };
        for (const k of Object.keys(config.sessionState)) {
          Reflect.deleteProperty(config.sessionState, k);
        }
        Object.assign(config.sessionState, replacement);
      }
    },
  };

  // Flag for PTL recovery — when set, the outer loop should re-enter without consuming a turn
  let ptlRecovered = false;

  while (turnNumber < maxTurns) {
    throwIfAborted(abortController.signal);

    // After PTL recovery we re-enter the same turn, so don't increment
    if (!ptlRecovered) {
      turnNumber++;
      yield { type: 'turn_start', turnNumber };
    }
    ptlRecovered = false;

    // Tracer — start turn span
    const turnSpanId =
      tracer?.span('turn', {
        parentSpanId: mainSpanId,
        category: 'agent',
        attributes: { turnNumber },
      }) ?? '';

    // Track stop reason for this turn (used in finally to close span)
    let turnStopReason = 'unknown';

    try {
      // --- onTurnStart hook (1.1) ---
      const turnStartChain = await runTurnStartHook(config.hooks, {
        type: 'onTurnStart',
        turnNumber,
      });
      if (turnStartChain.result.continue === false) {
        turnStopReason = turnStartChain.result.stopReason ?? 'hook_stopped';
        yield* finalizeTurn(config, turnNumber, turnStopReason, cumulativeUsage);
        break;
      }
      // Inject additionalContext from hook as a user message
      if (turnStartChain.result.additionalContext) {
        messages.push(createUserMessage(turnStartChain.result.additionalContext));
      }

      // --- Auto-compact if needed ---
      if (config.contextWindow) {
        try {
          const tokensBefore = estimateMessagesTokenCount(messages);
          const compactResult = await autoCompactIfNeeded(messages, {
            provider,
            model,
            contextWindow: config.contextWindow,
            threshold: config.compactThreshold ?? 0.8,
            circuitState: compactCircuit,
          });
          if (compactResult) {
            // Replace messages in-place
            messages.length = 0;
            messages.push(...compactResult.messages);
            compactCircuit = recordCompactSuccess(compactCircuit);

            const tokensAfter = estimateMessagesTokenCount(messages);

            logger?.info('Compaction', {
              method: compactResult.method,
              tokensBefore,
              tokensAfter,
              messageCount: messages.length,
            });

            yield {
              type: 'compact',
              summary: compactResult.summary,
              method: compactResult.method,
              messageCount: messages.length,
            } as AgentEvent;

            // --- onCompact hook (1.1) ---
            await runCompactHook(config.hooks, {
              type: 'onCompact',
              summary: compactResult.summary,
              tokensBefore,
              tokensAfter,
            });

            // Post-compact cleanup: clear readFileState so stale entries don't persist
            readFileState.clear();
          }
        } catch {
          // Auto-compact failure is non-fatal; track for circuit breaker
          compactCircuit = recordCompactFailure(compactCircuit);
        }
      }

      // Run pre-query hook — through runner.ts safe wrapper
      const preQueryChain = await runPreQueryHook(config.hooks, {
        type: 'preQuery',
        messageCount: messages.length,
        turnNumber,
      });
      if (preQueryChain.result.continue === false) {
        turnStopReason = preQueryChain.result.stopReason ?? 'hook_stopped';
        yield* finalizeTurn(config, turnNumber, turnStopReason, cumulativeUsage);
        break;
      }

      // --- Query the model (with retry) ---
      let responseContent: ProviderContentBlock[] = [];
      let turnUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
      let stopReason = 'end_turn';
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          // Exponential backoff with jitter
          const baseDelay = INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);
          const jitter = Math.random() * 0.3 * baseDelay;
          const delay = Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);
          await abortableSleep(delay, abortController.signal);
        }

        // Buffer events during streaming — only flush on success to prevent
        // partial output leakage when a retry occurs after partial streaming.
        const pendingEvents: AgentEvent[] = [];
        const MAX_PENDING_EVENTS = 10_000;
        const bufferEvent = (evt: AgentEvent) => {
          if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push(evt);
        };
        let attemptSucceeded = false;

        try {
          const streamParams = {
            model: currentModel,
            messages: normalizeMessageOrder([...messages]),
            systemPrompt: config.systemPrompt ?? '',
            tools: toolSchemas.length > 0 ? toolSchemas : undefined,
            thinkingConfig: config.thinkingConfig
              ? {
                  type: config.thinkingConfig.type,
                  budgetTokens: config.thinkingConfig.budgetTokens,
                }
              : undefined,
            maxOutputTokens: config.maxOutputTokens,
            temperature: config.temperature,
            signal: abortController.signal,
          };

          const contentBlocks: ProviderContentBlock[] = [];
          const blockBuilders = new Map<number, BlockBuilder>();

          for await (const event of provider.streamMessage(streamParams)) {
            switch (event.type) {
              case 'message_start':
                if (event.usage) {
                  turnUsage = { ...turnUsage, ...event.usage };
                }
                break;

              case 'content_block_start':
                blockBuilders.set(event.index, { ...event.block } as BlockBuilder);
                if (event.block.type === 'tool_use') {
                  bufferEvent({
                    type: 'tool_use_start',
                    toolName: event.block.name,
                    toolUseId: event.block.id,
                    input: event.block.input,
                  });
                }
                break;

              case 'content_block_delta':
                if (event.delta.type === 'text_delta') {
                  bufferEvent({ type: 'text', text: event.delta.text });
                  const builder = blockBuilders.get(event.index);
                  if (builder && builder.type === 'text') {
                    builder.text = (builder.text || '') + event.delta.text;
                  }
                } else if (event.delta.type === 'thinking_delta') {
                  bufferEvent({ type: 'thinking', thinking: event.delta.thinking });
                  const builder = blockBuilders.get(event.index);
                  if (builder && builder.type === 'thinking') {
                    builder.thinking = (builder.thinking || '') + event.delta.thinking;
                  }
                } else if (event.delta.type === 'input_json_delta') {
                  const builder = blockBuilders.get(event.index);
                  if (builder && builder.type === 'tool_use') {
                    builder._jsonAccumulator =
                      (builder._jsonAccumulator || '') + event.delta.partial_json;
                  }
                }
                break;

              case 'content_block_stop': {
                const builder = blockBuilders.get(event.index);
                if (builder) {
                  if (builder.type === 'tool_use' && builder._jsonAccumulator) {
                    try {
                      builder.input = JSON.parse(builder._jsonAccumulator);
                    } catch (parseError) {
                      // Mark parse failure — tool execution will return an error
                      // instead of running with empty input
                      builder.input = {};
                      builder._parseError = `Failed to parse tool input JSON: ${
                        parseError instanceof Error ? parseError.message : String(parseError)
                      }. Accumulated: ${builder._jsonAccumulator.slice(0, 200)}`;
                    }
                    delete builder._jsonAccumulator;
                  }
                  contentBlocks.push(builder as ProviderContentBlock);
                  blockBuilders.delete(event.index);
                }
                break;
              }

              case 'message_delta':
                if (event.stopReason) stopReason = event.stopReason;
                if (event.usage) {
                  turnUsage = {
                    inputTokens: event.usage.inputTokens || turnUsage.inputTokens,
                    outputTokens: event.usage.outputTokens || turnUsage.outputTokens,
                    cacheCreationInputTokens:
                      event.usage.cacheCreationInputTokens ?? turnUsage.cacheCreationInputTokens,
                    cacheReadInputTokens:
                      event.usage.cacheReadInputTokens ?? turnUsage.cacheReadInputTokens,
                  };
                }
                break;

              case 'error':
                bufferEvent({ type: 'error', error: event.error });
                throw event.error;
            }
          }

          attemptSucceeded = true;

          // Success — flush all buffered events
          for (const evt of pendingEvents) {
            yield evt;
          }

          responseContent = contentBlocks;
          lastError = null;
          break; // Success — exit retry loop
        } catch (error) {
          lastError = error;

          if (!attemptSucceeded) {
            // Discard all buffered events from the failed attempt —
            // they represent partial/corrupt output that should not
            // be visible to the caller.
            // Also reset turn-level state that was accumulated during
            // the failed streaming attempt.
            turnUsage = { inputTokens: 0, outputTokens: 0 };
          }

          if (isAbortError(error)) {
            // Inject synthetic tool_results before exiting
            const syntheticResults = createMissingToolResults(messages, 'Operation was aborted.');
            if (syntheticResults.length > 0) {
              messages.push({ role: 'user', content: syntheticResults });
            }
            turnStopReason = 'aborted';
            yield* finalizeTurn(config, turnNumber, 'aborted', cumulativeUsage);
            return; // Hard exit
          }

          // --- Prompt-too-long detection and recovery ---
          if (isPromptTooLongError(error) && config.contextWindow) {
            // Inject synthetic tool_results for any unpaired tool_use
            const syntheticResults = createMissingToolResults(
              messages,
              'Tool execution was interrupted due to context overflow.'
            );
            if (syntheticResults.length > 0) {
              messages.push({ role: 'user', content: syntheticResults });
            }

            const targetTokens = Math.floor(config.contextWindow * 0.7);
            const { messages: truncated, droppedGroups } = truncateHeadForPTLRetry(
              messages,
              targetTokens
            );

            if (droppedGroups > 0) {
              messages.length = 0;
              messages.push(...truncated);

              yield {
                type: 'compact',
                summary: `Truncated ${droppedGroups} groups due to prompt-too-long error`,
                method: 'truncate',
                messageCount: messages.length,
              } as AgentEvent;

              // Signal the outer while-loop to re-enter without consuming a turn number
              ptlRecovered = true;
              lastError = null;
              break; // Exit retry loop → outer loop will `continue` via ptlRecovered flag
            }
          }

          // --- onError hook (1.1) ---
          if (error instanceof Error) {
            await runErrorHook(config.hooks, { type: 'onError', error });
          }

          // Inject synthetic tool_results before retry
          const syntheticResults = createMissingToolResults(
            messages,
            'API error occurred during tool execution.'
          );
          if (syntheticResults.length > 0) {
            messages.push({ role: 'user', content: syntheticResults });
          }

          if (attempt < MAX_RETRIES && isRetryableError(error, config.querySource)) {
            logger?.warn('API retry', {
              attempt: attempt + 1,
              maxRetries: MAX_RETRIES + 1,
              error: error instanceof Error ? error.message : String(error),
              model: currentModel,
            });

            // Track consecutive 529s for model fallback
            const is529 =
              error &&
              typeof error === 'object' &&
              'status' in error &&
              (error as { status: number }).status === 529;
            if (is529) {
              consecutive529s++;
              // Switch to fallback model after too many consecutive 529s
              if (
                config.fallbackModel &&
                consecutive529s >= (config.maxConsecutive529s ?? 3) &&
                currentModel !== config.fallbackModel
              ) {
                currentModel = config.fallbackModel;
                yield {
                  type: 'error',
                  error: new ProviderError(
                    `Switching to fallback model: ${currentModel}`,
                    529,
                    provider.providerId
                  ),
                };
              }
            } else {
              consecutive529s = 0;
            }

            yield {
              type: 'error',
              error: new ProviderError(
                `API error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying: ${error instanceof Error ? error.message : String(error)}`,
                undefined,
                provider.providerId,
                error instanceof Error ? error : undefined
              ),
            };
            continue; // Retry
          }

          // Non-retryable or max retries exceeded
          throw new ProviderError(
            error instanceof Error ? error.message : String(error),
            undefined,
            provider.providerId,
            error instanceof Error ? error : undefined
          );
        }
      }

      // If PTL recovery succeeded, skip the rest and re-enter the outer loop to retry the model call
      if (ptlRecovered) {
        // Check turn limit before re-entering to prevent off-by-one overflow
        if (turnNumber >= maxTurns) {
          yield { type: 'error', error: new BudgetExceededError('Maximum turns reached', 'turns') };
          break;
        }
        continue;
      }

      if (lastError) {
        throw new ProviderError(
          lastError instanceof Error ? lastError.message : String(lastError),
          undefined,
          provider.providerId,
          lastError instanceof Error ? lastError : undefined
        );
      }

      // Update cumulative usage
      const sdkUsage = providerUsageToUsage(turnUsage);
      cumulativeUsage = addUsage(cumulativeUsage, sdkUsage);
      yield { type: 'usage', usage: cumulativeUsage };

      // --- Usage callback (2.5) ---
      if (config.onUsage) {
        try {
          await config.onUsage({
            sessionId: config.sessionId,
            turnNumber,
            usage: sdkUsage,
            model: currentModel,
            provider: provider.providerId,
          });
        } catch {
          // Usage callback errors are non-fatal
        }
      }

      // Check budget
      if (config.maxBudgetUsd) {
        const modelInfo = provider.getModelInfo(currentModel);
        const inputCost =
          (cumulativeUsage.inputTokens / 1_000_000) * (modelInfo.inputTokenCostPer1M ?? 0);
        const outputCost =
          (cumulativeUsage.outputTokens / 1_000_000) * (modelInfo.outputTokenCostPer1M ?? 0);
        if (inputCost + outputCost > config.maxBudgetUsd) {
          logger?.info('Budget exceeded', {
            type: 'cost',
            inputCost,
            outputCost,
            limit: config.maxBudgetUsd,
          });
          yield { type: 'error', error: new BudgetExceededError('Budget exceeded', 'cost') };
          turnStopReason = 'budget_exceeded';
          yield* finalizeTurn(config, turnNumber, 'budget_exceeded', cumulativeUsage);
          break;
        }
      }

      // Check token budget
      if (config.maxTokens) {
        const totalTokens = cumulativeUsage.inputTokens + cumulativeUsage.outputTokens;
        if (totalTokens > config.maxTokens) {
          logger?.info('Budget exceeded', { type: 'tokens', totalTokens, limit: config.maxTokens });
          yield {
            type: 'error',
            error: new BudgetExceededError('Token budget exceeded', 'tokens'),
          };
          turnStopReason = 'budget_exceeded';
          yield* finalizeTurn(config, turnNumber, 'budget_exceeded', cumulativeUsage);
          break;
        }
      }

      // Diminishing returns detection — check if agent appears stuck
      // Only count non-tool-call turns to avoid false positives on tool-heavy agents
      outputTokenHistory.push(sdkUsage.outputTokens);
      if (outputTokenHistory.length >= DIMINISHING_WINDOW) {
        const recent = outputTokenHistory.slice(-DIMINISHING_WINDOW);
        const allLow = recent.every((t) => t < DIMINISHING_THRESHOLD);
        if (allLow) {
          yield {
            type: 'error',
            error: new BudgetExceededError(
              `Agent appears stuck — low output for ${DIMINISHING_WINDOW} consecutive turns`,
              'turns'
            ),
          };
          turnStopReason = 'diminishing_returns';
          yield* finalizeTurn(config, turnNumber, 'diminishing_returns', cumulativeUsage);
          break;
        }
      }

      // Add assistant message to history
      const assistantMessage: ProviderMessage = {
        role: 'assistant',
        content: responseContent,
      };
      messages.push(assistantMessage);

      // Run post-query hook — through runner.ts safe wrapper
      await runPostQueryHook(config.hooks, {
        type: 'postQuery',
        stopReason,
        turnNumber,
        outputTokens: turnUsage.outputTokens,
      });

      // Check for tool use
      const toolUseBlocks = responseContent.filter(
        (b): b is ProviderToolUseBlock => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') {
        // max_output_tokens recovery: if response was truncated, inject resume message
        if (stopReason === 'max_tokens' && responseContent.length > 0) {
          const lastBlock = responseContent[responseContent.length - 1];
          if (lastBlock && lastBlock.type === 'text') {
            // Inject a resume message and continue the loop (up to 2 retries)
            const MAX_RESUME_RETRIES = 2;
            const resumeKey = '__max_tokens_resume_count';
            const resumeCount = (execContext.getState()[resumeKey] as number) ?? 0;
            if (resumeCount < MAX_RESUME_RETRIES) {
              execContext.setState((prev) => ({ ...prev, [resumeKey]: resumeCount + 1 }));
              messages.push(
                createUserMessage('Resume directly from where you left off — no recap.')
              );
              turnStopReason = 'max_tokens';
              yield* finalizeTurn(config, turnNumber, 'max_tokens', cumulativeUsage);
              continue;
            }
          }
        }
        // No tool calls — we're done
        turnStopReason = stopReason;
        yield* finalizeTurn(config, turnNumber, stopReason, cumulativeUsage);
        break;
      }

      // Execute tool calls
      // Reset diminishing returns tracking — tool-call turns indicate active work
      outputTokenHistory.length = 0;
      const toolRequests: ToolUseRequest[] = toolUseBlocks.map((block) => ({
        id: block.id,
        name: block.name,
        input: block.input,
        // Propagate JSON parse errors from streaming accumulation
        _parseError: (block as BlockBuilder)._parseError,
      }));

      // Update execution context messages
      execContext.messages = messages;

      const toolResults: ProviderContentBlock[] = [];
      const additionalMessages: ProviderMessage[] = [];

      for await (const update of runTools(toolRequests, execContext, {
        onPermissionRequest: async (tool, input) => {
          // Resolve isReadOnly/isDestructive from tool definition (1.6)
          const matchedTool = tools.find((t) => t.name === tool);
          const parsedInput = matchedTool?.inputSchema.safeParse(input);
          // When validation fails, use conservative defaults (non-readonly, potentially destructive)
          const isReadOnly = parsedInput?.success
            ? (matchedTool?.isReadOnly(parsedInput.data) ?? false)
            : false;
          const isDestructive = parsedInput?.success
            ? (matchedTool?.isDestructive?.(parsedInput.data) ?? false)
            : true;

          const decision = await checkToolPermission(
            tool,
            input,
            { cwd: execContext.cwd, isReadOnly, isDestructive },
            config.permissionMode,
            config.permissionHandler,
            {
              rules: config.permissionRules,
              denialTracking,
              denialLimits: config.denialLimits,
            }
          );

          if (decision.behavior === 'allow') {
            // Pass through updatedInput if the handler provided one
            return decision.updatedInput !== undefined
              ? { allow: true, updatedInput: decision.updatedInput }
              : true;
          }
          if (decision.behavior === 'deny') return false;

          // behavior === 'ask': emit event and wait for host response
          if (config.emitEvent) {
            const PERMISSION_TIMEOUT_MS = config.permissionTimeoutMs ?? 30_000;
            return new Promise<boolean | { allow: boolean; updatedInput?: unknown }>((resolve) => {
              const timer = setTimeout(() => {
                resolve(false);
                // Emit error event so the caller knows why the tool was denied
                config.emitEvent?.({
                  type: 'error',
                  error: new ProviderError(
                    `Permission request for '${tool}' timed out after ${PERMISSION_TIMEOUT_MS}ms — denied by default`,
                    undefined,
                    'permission'
                  ),
                });
              }, PERMISSION_TIMEOUT_MS);
              config.emitEvent!({
                type: 'permission_request',
                tool,
                input,
                message: decision.message,
                resolve: (response) => {
                  clearTimeout(timer);
                  resolve(response);
                },
              });
            });
          }

          // No event listener: safe default — deny non-readonly
          return false;
        },
        hooks: config.hooks,
      })) {
        // Always pick up the latest context from the orchestration layer
        execContext = update.newContext;

        // Track cwd changes from tool contextModifiers (e.g. Bash cd)
        if (execContext.cwd !== currentCwd) {
          currentCwd = execContext.cwd;
          config.onCwdChange?.(currentCwd);
        }

        // Skip context-only updates (emitted after concurrent batch modifier application)
        if (!update.executionResult) continue;

        const result = update.executionResult;

        yield {
          type: 'tool_use_end',
          toolUseId: result.toolUseId,
          toolName: result.toolName,
          result: result.result.data,
          isError: result.isError,
        };

        logger?.debug('Tool execution', {
          tool: result.toolName,
          toolUseId: result.toolUseId,
          isError: result.isError,
        });

        // Tracer — record tool execution
        tracer?.instant('toolExecution', {
          toolName: result.toolName,
          toolUseId: result.toolUseId,
          isError: result.isError,
        });

        // --- Collect newMessages ---
        if (result.result.newMessages?.length) {
          for (const msg of result.result.newMessages) {
            additionalMessages.push({
              role: msg.role,
              content: msg.content as ProviderContentBlock[],
            });
          }
        }

        // Map tool result using the tool's mapToolResult if available
        const tool = tools.find((t) => t.name === result.toolName);
        let resultContent: string | ProviderContentBlock[];
        if (tool && result.result.data !== undefined) {
          const mapped = tool.mapToolResult(result.result.data, result.toolUseId);
          resultContent =
            typeof mapped.content === 'string'
              ? mapped.content
              : (mapped.content as ProviderContentBlock[]);
        } else {
          resultContent =
            typeof result.result.data === 'string'
              ? result.result.data
              : JSON.stringify(result.result.data);
        }

        // Apply content size limit AFTER mapping (so mapToolResult gets full data)
        if (typeof resultContent === 'string' && tool?.maxResultSizeChars) {
          const limited = enforceContentLimit(
            resultContent,
            result.toolName,
            tool.maxResultSizeChars
          );
          resultContent = limited.content;
        } else if (Array.isArray(resultContent) && tool?.maxResultSizeChars) {
          const limited = enforceMultimodalLimit(
            resultContent,
            result.toolName,
            tool.maxResultSizeChars
          );
          resultContent = limited.content;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: result.toolUseId,
          content: resultContent,
          is_error: result.isError,
        } as ProviderToolResultBlock);
      }

      // Enforce message-level aggregate budget for tool results to prevent
      // context window overflow when many concurrent tools return large results
      const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;
      let totalResultChars = 0;
      for (const tr of toolResults) {
        const block = tr as ProviderToolResultBlock;
        const content =
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        totalResultChars += content.length;
      }
      if (totalResultChars > MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) {
        // Truncate the largest results first until under budget
        const resultsWithSize = toolResults.map((tr, idx) => {
          const block = tr as ProviderToolResultBlock;
          const content =
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          return { idx, size: content.length };
        });
        resultsWithSize.sort((a, b) => b.size - a.size);

        let currentTotal = totalResultChars;
        for (const entry of resultsWithSize) {
          if (currentTotal <= MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) break;
          const block = toolResults[entry.idx] as ProviderToolResultBlock;
          if (typeof block.content === 'string' && block.content.length > 10_000) {
            const maxAllowed = Math.max(
              10_000,
              block.content.length - (currentTotal - MAX_TOOL_RESULTS_PER_MESSAGE_CHARS)
            );
            const truncated = block.content.slice(0, maxAllowed);
            currentTotal -= block.content.length - truncated.length;
            // Create a new block with truncated content to avoid mutation
            toolResults[entry.idx] = {
              ...block,
              content: `${truncated}\n\n... [Truncated to stay within message budget]`,
            } as ProviderContentBlock;
          } else if (Array.isArray(block.content) && entry.size > 10_000) {
            // Truncate multimodal content using enforceMultimodalLimit
            const maxAllowed = Math.max(
              10_000,
              entry.size - (currentTotal - MAX_TOOL_RESULTS_PER_MESSAGE_CHARS)
            );
            const limited = enforceMultimodalLimit(block.content, 'aggregate', maxAllowed);
            const newSize = JSON.stringify(limited.content).length;
            currentTotal -= entry.size - newSize;
            toolResults[entry.idx] = {
              ...block,
              content: limited.content,
            } as ProviderContentBlock;
          }
        }
      }

      // Add tool results as user message
      const toolResultMessage: ProviderMessage = {
        role: 'user',
        content: toolResults,
      };
      messages.push(toolResultMessage);

      // Prune readFileState to prevent memory leaks in long sessions
      pruneReadFileState(readFileState);

      // Add any newMessages from tool results (1.4)
      if (additionalMessages.length > 0) {
        messages.push(...additionalMessages);
      }

      // End of turn
      turnStopReason = 'tool_use';
      yield* finalizeTurn(config, turnNumber, 'tool_use', cumulativeUsage);

      // Check if max turns reached
      if (turnNumber >= maxTurns) {
        turnStopReason = 'max_turns';
        yield { type: 'error', error: new BudgetExceededError('Maximum turns reached', 'turns') };
        break;
      }
    } finally {
      // Guarantee span closure on all exit paths
      tracer?.endSpan(turnSpanId, { stopReason: turnStopReason });
    }
  }

  // Tracer — end main loop span
  tracer?.endSpan(mainSpanId, { turns: turnNumber });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build tool schemas for the provider.
 * Pre-filters tools that are unconditionally denied by permission rules
 * to avoid wasting tokens on tools the model can never use.
 */
async function buildToolSchemas(
  tools: SDKTool[],
  permissionRules?: PermissionRule[]
): Promise<ProviderToolSchema[]> {
  const schemas: ProviderToolSchema[] = [];

  for (const tool of tools) {
    if (!tool.isEnabled()) continue;

    // Pre-filter: if a deny rule unconditionally blocks this tool
    // (no inputMatch pattern), don't expose it to the model
    if (permissionRules?.length) {
      const staticDeny = permissionRules.some(
        (rule) => rule.toolName === tool.name && rule.behavior === 'deny' && !rule.pattern
      );
      if (staticDeny) continue;
    }

    const description = await tool.prompt({ tools });

    let inputSchema: Record<string, unknown>;
    if (tool.inputJSONSchema) {
      inputSchema = tool.inputJSONSchema;
    } else {
      inputSchema = zodToJsonSchema(tool.inputSchema);
    }

    schemas.push({
      name: tool.name,
      description,
      inputSchema,
    });
  }

  return schemas;
}

/**
 * Convert Zod schema to JSON Schema using the zod-to-json-schema library.
 * Results are cached per schema instance for performance.
 */
const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  let cached = schemaCache.get(schema);
  if (cached) return cached;
  cached = z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;
  delete cached.$schema;
  schemaCache.set(schema, cached);
  return cached;
}
