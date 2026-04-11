/**
 * Context compaction — compresses conversation history to stay within context limits.
 * Enhanced with turn-aware micro-compaction, token-budget-based full compaction,
 * truncateHeadForPTLRetry, postCompactCleanup, auto-compact trigger,
 * buffer zone for safety margin, and circuit breaker for consecutive failures.
 */

import type { ModelProvider, ProviderContentBlock, ProviderMessage } from '../providers/types.js';
import { estimateMessagesTokenCount } from '../utils/tokens.js';
import { groupMessagesByApiRound, type MessageGroup } from './message-groups.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
const OUTPUT_RESERVE_TOKENS = 4_000;
const MAX_CONSECUTIVE_FAILURES = 3;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CompactOptions {
  /** Provider to use for summarization */
  provider: ModelProvider;
  /** Model to use for summarization */
  model: string;
  /** Maximum tokens for the compacted context */
  maxTokens: number;
  /** Ratio of context window to trigger compaction (0-1, default: 0.8) */
  threshold?: number;
  /** Optional cached file-read state to clear after successful compaction */
  readFileState?: Map<string, unknown>;
  /** Optional callback invoked after successful compaction */
  onCompactComplete?: (result: { messages: ProviderMessage[]; summary: string }) => void;
}

export interface CompactTrackingState {
  consecutiveFailures: number;
}

/**
 * Circuit breaker state for tracking consecutive compact failures.
 * After {@link MAX_CONSECUTIVE_FAILURES} consecutive failures the compaction
 * layer stops attempting LLM-based compaction and falls back to media
 * stripping only.
 */
export interface CompactCircuitState {
  /** Number of consecutive compaction failures observed */
  consecutiveFailures: number;
  /** Whether the circuit is currently open (compaction disabled) */
  isOpen: boolean;
  /** Timestamp (epoch ms) when the circuit was opened, or null */
  openedAt: number | null;
}

/** Create a fresh {@link CompactCircuitState}. */
export function createCompactCircuitState(): CompactCircuitState {
  return { consecutiveFailures: 0, isOpen: false, openedAt: null };
}

/**
 * Record a compaction failure and potentially open the circuit.
 * Returns the updated state (new object — does not mutate the input).
 */
export function recordCompactFailure(state: CompactCircuitState): CompactCircuitState {
  const failures = state.consecutiveFailures + 1;
  const isOpen = failures >= MAX_CONSECUTIVE_FAILURES;
  return {
    consecutiveFailures: failures,
    isOpen,
    openedAt: isOpen ? Date.now() : state.openedAt,
  };
}

/**
 * Record a compaction success and reset the circuit breaker.
 * Returns the updated state (new object — does not mutate the input).
 */
export function recordCompactSuccess(state: CompactCircuitState): CompactCircuitState {
  return { consecutiveFailures: 0, isOpen: false, openedAt: null };
}

export interface AutoCompactConfig {
  /** Provider for summarization */
  provider: ModelProvider;
  /** Model for summarization */
  model: string;
  /** Total context window size in tokens */
  contextWindow: number;
  /** Trigger threshold ratio (0-1, default: 0.8) */
  threshold?: number;
  /** Whether to try micro-compact before full compact (default: true) */
  enableMicroCompact?: boolean;
  /** Tracking state for circuit breaker */
  tracking?: CompactTrackingState;
  /** Circuit breaker state — preferred over `tracking` */
  circuitState?: CompactCircuitState;
  /** Optional cached file-read state to clear after successful compaction */
  readFileState?: Map<string, unknown>;
  /** Optional callback invoked after successful compaction */
  onCompactComplete?: (result: { messages: ProviderMessage[]; summary: string }) => void;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Check if compaction is needed based on message token count.
 * Uses both a percentage-based threshold and an absolute limit
 * (context window minus buffer minus output reserve) for safety.
 */
export function shouldCompact(
  messages: readonly ProviderMessage[],
  contextWindow: number,
  threshold: number = 0.8
): boolean {
  if (contextWindow <= 0) return false;
  const currentTokens = estimateMessagesTokenCount(messages);
  if (currentTokens === 0) return false;
  const percentageLimit = contextWindow * threshold;
  // Buffer cannot exceed 30% of context window to prevent negative absoluteLimit on small models
  const effectiveBuffer = Math.min(
    AUTOCOMPACT_BUFFER_TOKENS + OUTPUT_RESERVE_TOKENS,
    Math.floor(contextWindow * 0.3)
  );
  const absoluteLimit = contextWindow - effectiveBuffer;
  return currentTokens > Math.min(percentageLimit, absoluteLimit);
}

// ---------------------------------------------------------------------------
// Micro-compaction — turn-aware clearing of old tool results
// ---------------------------------------------------------------------------

const TOOL_RESULT_STUB = '[Previous tool result cleared to save context]';

/**
 * Micro-compact: replace old tool result contents with stubs.
 * Uses turn-aware grouping to protect recent complete turns.
 * Only affects tool_result blocks outside the last `keepRecentGroups` turn groups.
 * This is cheap (no API call) and often frees enough space.
 *
 * Returns the number of tokens freed (estimated).
 */
export function microCompact(
  messages: ProviderMessage[],
  keepRecentGroups: number = 2
): { messages: ProviderMessage[]; freedTokens: number } {
  const groups = groupMessagesByApiRound(messages);
  if (groups.length === 0) return { messages, freedTokens: 0 };

  // Determine which messages are protected (in the last N groups)
  const protectedGroupStart = Math.max(0, groups.length - keepRecentGroups);
  const protectedMessages = new Set<ProviderMessage>();
  for (let i = protectedGroupStart; i < groups.length; i++) {
    for (const msg of groups[i]!.messages) {
      protectedMessages.add(msg);
    }
  }

  let freedTokens = 0;

  const compacted = messages.map((msg) => {
    if (protectedMessages.has(msg)) return msg; // Keep protected messages intact

    const newContent = msg.content.map((block) => {
      if (block.type === 'tool_result') {
        if (block.content && block.content !== TOOL_RESULT_STUB) {
          const oldSize =
            typeof block.content === 'string'
              ? block.content.length
              : JSON.stringify(block.content).length;
          freedTokens += Math.ceil(oldSize / 4); // Rough token estimate
          return { ...block, content: TOOL_RESULT_STUB };
        }
      }
      return block;
    });

    return { ...msg, content: newContent };
  });

  return { messages: compacted, freedTokens };
}

// ---------------------------------------------------------------------------
// Tool result summarization helper
// ---------------------------------------------------------------------------

function summarizeToolResult(block: ProviderContentBlock, maxChars = 2000): string {
  if (block.type !== 'tool_result') return '';
  const content = (block as any).content;
  if (!content) return '[Empty tool result]';
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n')
        : JSON.stringify(content);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n... [truncated]`;
}

// ---------------------------------------------------------------------------
// Full compaction — turn-aware summarization with token budget
// ---------------------------------------------------------------------------

/**
 * Compact a conversation by summarizing earlier messages.
 * Uses turn-aware grouping to select messages to keep based on token budget.
 * Returns the compacted messages and a summary string.
 */
export async function compactMessages(
  messages: ProviderMessage[],
  options: CompactOptions
): Promise<{ messages: ProviderMessage[]; summary: string }> {
  if (messages.length <= 2) {
    return { messages, summary: '' };
  }

  const groups = groupMessagesByApiRound(messages);
  if (groups.length <= 1) {
    return { messages, summary: '' };
  }

  // Select groups to keep from the end, within token budget (50% of maxTokens)
  const keepBudget = Math.floor(options.maxTokens * 0.5);
  let keepTokens = 0;
  let keepFromIndex = groups.length; // Start from after the last group

  for (let i = groups.length - 1; i >= 0; i--) {
    const groupTokens = groups[i]!.tokenCount;
    if (keepTokens + groupTokens > keepBudget && keepFromIndex < groups.length) {
      break; // Would exceed budget and we already have at least one group
    }
    keepTokens += groupTokens;
    keepFromIndex = i;
  }

  // Always keep at least the last group
  if (keepFromIndex >= groups.length) {
    keepFromIndex = groups.length - 1;
  }

  const toSummarizeGroups = groups.slice(0, keepFromIndex);
  const toKeepGroups = groups.slice(keepFromIndex);

  if (toSummarizeGroups.length === 0) {
    return { messages, summary: '' };
  }

  const toSummarize = toSummarizeGroups.flatMap((g) => g.messages);
  const toKeep = toKeepGroups.flatMap((g) => g.messages);

  // Build summary prompt
  const summaryText = toSummarize
    .map((m) => {
      const text = m.content
        .map((b) => {
          if ('text' in b && typeof (b as { text?: string }).text === 'string')
            return (b as { text: string }).text;
          if (b.type === 'tool_use')
            return `[Tool: ${b.name}](${JSON.stringify(b.input).slice(0, 200)})`;
          if (b.type === 'tool_result') return `[Tool Result]: ${summarizeToolResult(b)}`;
          return '';
        })
        .filter(Boolean)
        .join('\n');
      return `${m.role}: ${text}`;
    })
    .join('\n\n');

  const MAX_COMPACT_RETRIES = 2;
  let response: any;
  let lastCompactError: unknown;

  for (let compactAttempt = 0; compactAttempt <= MAX_COMPACT_RETRIES; compactAttempt++) {
    try {
      response = await options.provider.generateMessage({
        model: options.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Summarize the following conversation concisely. You MUST preserve:\n- All file paths mentioned\n- Code changes made (what was changed and why)\n- Key decisions and their rationale\n- Current task progress and next steps\n\n${summaryText}`,
              },
            ],
          },
        ],
        systemPrompt:
          'You are a conversation summarizer. Create a concise but thorough summary preserving all technical details: file paths, code changes, decisions made, errors encountered, and current progress. Do not omit any file paths or tool actions.',
        maxOutputTokens: 4000,
      });
      lastCompactError = null;
      break;
    } catch (error) {
      lastCompactError = error;
      if (compactAttempt < MAX_COMPACT_RETRIES) {
        // Brief delay before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * (compactAttempt + 1)));
      }
    }
  }

  if (lastCompactError || !response) {
    // Fall back to simple truncation: keep system-like first message + last N messages
    const FALLBACK_KEEP_COUNT = 6;
    const fallbackMessages: ProviderMessage[] = [];

    // Keep first message if it looks like a system/context message
    if (messages.length > 0) {
      fallbackMessages.push(messages[0]!);
    }

    // Keep the last N messages
    const tail = messages.slice(Math.max(1, messages.length - FALLBACK_KEEP_COUNT));
    fallbackMessages.push(...tail);

    // Prepend a truncation notice after the first message
    if (fallbackMessages.length > 1) {
      const notice: ProviderMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '[Context truncated due to compaction failure. Earlier conversation history was dropped.]',
          },
        ],
      };
      fallbackMessages.splice(1, 0, notice);
    }

    return { messages: fallbackMessages, summary: '' };
  }

  const summary = (response.content as { type: string; text?: string }[])
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Build compacted messages with boundary marker for resume semantics.
  // The _compactBoundary flag allows session restore to identify where
  // compaction occurred and resume from the correct point.
  const summaryMessage: ProviderMessage & { _compactBoundary?: boolean } = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `[Previous conversation summary]\n${summary}\n[End of summary — the conversation continues below]`,
      },
    ],
    _compactBoundary: true,
  };

  const compactedMessages: ProviderMessage[] = [
    summaryMessage as ProviderMessage,
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I understand the context from the summary. Let me continue.',
        },
      ],
    },
    ...toKeep,
  ];

  // Post-compact: clear cached file-read state and invoke callback
  if (options.readFileState) {
    options.readFileState.clear();
  }

  const result = { messages: compactedMessages, summary };

  if (options.onCompactComplete) {
    options.onCompactComplete(result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Truncate head for prompt-too-long retry
// ---------------------------------------------------------------------------

/**
 * Drop message groups from the head until total tokens are under targetTokens.
 * Ensures at least the last group is preserved.
 * Prepends a context-truncated notification message.
 */
export function truncateHeadForPTLRetry(
  messages: ProviderMessage[],
  targetTokens: number
): { messages: ProviderMessage[]; droppedGroups: number } {
  const groups = groupMessagesByApiRound(messages);
  if (groups.length <= 1) {
    return { messages, droppedGroups: 0 };
  }

  let totalTokens = estimateMessagesTokenCount(messages);
  let droppedGroups = 0;

  // Drop from head until under target or only one group remains
  while (droppedGroups < groups.length - 1 && totalTokens > targetTokens) {
    totalTokens -= groups[droppedGroups]!.tokenCount;
    droppedGroups++;
  }

  if (droppedGroups === 0) {
    return { messages, droppedGroups: 0 };
  }

  const keptMessages = groups.slice(droppedGroups).flatMap((g) => g.messages);

  // Prepend truncation notice
  const notice: ProviderMessage = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `[Context truncated: ${droppedGroups} earlier conversation groups were removed to fit within context limits. Continue based on the remaining context.]`,
      },
    ],
  };

  return {
    messages: [notice, ...keptMessages],
    droppedGroups,
  };
}

// ---------------------------------------------------------------------------
// Post-compact cleanup
// ---------------------------------------------------------------------------

/**
 * Validate compaction quality, clear cached state, and invoke completion callback.
 * Checks if the summary is suspiciously short or missing key context.
 */
export function postCompactCleanup(
  messages: ProviderMessage[],
  summary: string,
  options?: {
    readFileState?: Map<string, unknown>;
    onCompactComplete?: (result: { messages: ProviderMessage[]; summary: string }) => void;
  }
): { messages: ProviderMessage[]; isLowQuality: boolean } {
  const isLowQuality = summary.length < 200;

  // Clear cached file-read state so stale entries don't persist after compaction
  if (options?.readFileState) {
    options.readFileState.clear();
  }

  if (options?.onCompactComplete) {
    options.onCompactComplete({ messages, summary });
  }

  return { messages, isLowQuality };
}

// ---------------------------------------------------------------------------
// Media stripping — remove base64 images/documents from older messages
// ---------------------------------------------------------------------------

/**
 * Strip base64 media (images, documents) from older messages to save context space.
 * Preserves media in the last `keepRecentGroups` groups.
 */
export function stripMediaFromMessages(
  messages: ProviderMessage[],
  keepRecentGroups: number = 2
): { messages: ProviderMessage[]; strippedCount: number } {
  const groups = groupMessagesByApiRound(messages);
  if (groups.length === 0) return { messages, strippedCount: 0 };

  const protectedGroupStart = Math.max(0, groups.length - keepRecentGroups);
  const protectedMessages = new Set<ProviderMessage>();
  for (let i = protectedGroupStart; i < groups.length; i++) {
    for (const msg of groups[i]!.messages) {
      protectedMessages.add(msg);
    }
  }

  let strippedCount = 0;

  const result = messages.map((msg) => {
    if (protectedMessages.has(msg)) return msg;

    const newContent = msg.content.map((block) => {
      if (block.type === 'image') {
        strippedCount++;
        return {
          type: 'text' as const,
          text: '[Image removed for context compaction]',
        } as ProviderContentBlock;
      }
      if (block.type === 'document') {
        strippedCount++;
        return {
          type: 'text' as const,
          text: '[Document removed for context compaction]',
        } as ProviderContentBlock;
      }
      // Also strip base64 from tool_result content that contains images
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        const hasMedia = (block.content as any[]).some(
          (c: any) => c.type === 'image' || c.type === 'document'
        );
        if (hasMedia) {
          strippedCount++;
          const filtered = (block.content as any[]).map((c: any) => {
            if (c.type === 'image')
              return { type: 'text', text: '[Image removed for context compaction]' };
            if (c.type === 'document')
              return { type: 'text', text: '[Document removed for context compaction]' };
            return c;
          });
          return { ...block, content: filtered } as ProviderContentBlock;
        }
      }
      return block;
    });

    return { ...msg, content: newContent };
  });

  return { messages: result, strippedCount };
}

// ---------------------------------------------------------------------------
// Auto-compact: orchestrates micro + full compaction
// ---------------------------------------------------------------------------

/**
 * Auto-compact if the context is approaching its limit.
 * Strategy:
 *   1. Circuit breaker: skip if too many consecutive failures
 *      (still strips media as a lightweight fallback)
 *   2. Check if compaction is needed
 *   3. Try micro-compact first (cheap, no API call)
 *   4. If still over threshold, do full compaction (API call)
 *
 * Returns null if no compaction was needed.
 */
export async function autoCompactIfNeeded(
  messages: ProviderMessage[],
  config: AutoCompactConfig
): Promise<{ messages: ProviderMessage[]; summary: string; method: 'micro' | 'full' } | null> {
  const threshold = config.threshold ?? 0.8;

  // Circuit breaker: if open, only strip media — skip LLM-based compaction
  const circuitOpen =
    config.circuitState?.isOpen ||
    (config.tracking?.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_FAILURES;

  if (circuitOpen) {
    // Still attempt media stripping as a cheap fallback
    const { messages: mediaStripped, strippedCount } = stripMediaFromMessages(messages);
    if (strippedCount > 0) {
      return {
        messages: mediaStripped,
        summary: `Circuit breaker open — stripped ${strippedCount} media blocks only`,
        method: 'micro',
      };
    }
    return null;
  }

  if (!shouldCompact(messages, config.contextWindow, threshold)) {
    return null;
  }

  // Step 0.5: Strip media from older messages (free space without API call)
  const { messages: mediaStripped, strippedCount } = stripMediaFromMessages(messages);
  if (strippedCount > 0) {
    messages = mediaStripped;
    if (!shouldCompact(messages, config.contextWindow, threshold)) {
      return {
        messages,
        summary: `Stripped ${strippedCount} media blocks from older messages`,
        method: 'micro',
      };
    }
  }

  // Step 1: Try micro-compact
  if (config.enableMicroCompact !== false) {
    const { messages: microCompacted, freedTokens } = microCompact(messages);
    if (freedTokens > 0 && !shouldCompact(microCompacted, config.contextWindow, threshold)) {
      return {
        messages: microCompacted,
        summary: `Micro-compacted: freed ~${freedTokens} tokens by clearing old tool results`,
        method: 'micro',
      };
    }
    // Use micro-compacted version as base for full compaction (less work)
    messages = freedTokens > 0 ? microCompacted : messages;
  }

  // Step 2: Full compaction — errors are handled internally with truncation fallback
  const { messages: compacted, summary } = await compactMessages(messages, {
    provider: config.provider,
    model: config.model,
    maxTokens: Math.floor(config.contextWindow * 0.5), // Target 50% of context window
    threshold,
    readFileState: config.readFileState,
    onCompactComplete: config.onCompactComplete,
  });

  return { messages: compacted, summary, method: 'full' };
}
