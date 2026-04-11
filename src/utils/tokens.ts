/**
 * Token counting and estimation utilities.
 */

import type { Usage } from '../core/types.js';
import type { ProviderMessage, ProviderUsage } from '../providers/types.js';

/**
 * Calculate total context window tokens from usage data.
 */
export function getTokenCountFromUsage(usage: ProviderUsage): number {
  return (
    usage.inputTokens +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0) +
    usage.outputTokens
  );
}

/**
 * Count CJK characters in a string (Chinese, Japanese, Korean).
 * CJK characters typically encode as ~1.5 chars/token rather than ~4.
 */
function countCJKChars(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Content-type-aware token count estimation.
 * Uses different ratios based on detected content type:
 * - CJK content: ~1.5 chars/token
 * - Base64 encoded: ~3.5 chars/token
 * - Default (English/code): ~4 chars/token
 */
export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;

  // Check CJK ratio for multilingual content
  const sampleLen = Math.min(text.length, 500);
  const sample = text.slice(0, sampleLen);
  const cjkCount = countCJKChars(sample);
  const cjkRatio = cjkCount / sampleLen;

  if (cjkRatio > 0.3) {
    // CJK-heavy content: ~1.5 chars per token
    return Math.ceil(text.length / 1.5);
  }

  // Check for base64-encoded content (images, binary data)
  if (text.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(sample)) {
    return Math.ceil(text.length / 3.5);
  }

  // Default: English/code at ~4 chars per token
  return Math.ceil(text.length / 4);
}

/**
 * Estimate token count for an array of messages.
 */
export function estimateMessagesTokenCount(messages: readonly ProviderMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const block of msg.content) {
      if ('text' in block && typeof block.text === 'string') {
        total += estimateTokenCount(block.text);
      } else if ('thinking' in block && typeof block.thinking === 'string') {
        total += estimateTokenCount(block.thinking);
      } else if (block.type === 'tool_use') {
        total += estimateTokenCount(JSON.stringify(block.input));
      } else if (block.type === 'tool_result') {
        const content = block.content;
        if (typeof content === 'string') {
          total += estimateTokenCount(content);
        } else if (Array.isArray(content)) {
          for (const sub of content) {
            if ('text' in sub && typeof sub.text === 'string') {
              total += estimateTokenCount(sub.text);
            }
          }
        }
      }
      // Add per-block overhead
      total += 5;
    }
    // Add per-message overhead
    total += 10;
  }
  return total;
}

/**
 * Create a zero-initialized Usage object.
 */
export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

/**
 * Add two Usage objects together.
 * totalTokens is always recomputed from components to prevent drift.
 */
export function addUsage(a: Usage, b: Partial<Usage>): Usage {
  const inputTokens = a.inputTokens + (b.inputTokens ?? 0);
  const outputTokens = a.outputTokens + (b.outputTokens ?? 0);
  const cacheCreationInputTokens =
    (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0);
  const cacheReadInputTokens = (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0);

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    // Recompute totalTokens to prevent accumulation drift
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

/**
 * Convert provider usage to SDK usage.
 */
export function providerUsageToUsage(pu: ProviderUsage): Usage {
  const total =
    pu.inputTokens +
    pu.outputTokens +
    (pu.cacheCreationInputTokens ?? 0) +
    (pu.cacheReadInputTokens ?? 0);
  return {
    inputTokens: pu.inputTokens,
    outputTokens: pu.outputTokens,
    cacheCreationInputTokens: pu.cacheCreationInputTokens,
    cacheReadInputTokens: pu.cacheReadInputTokens,
    totalTokens: total,
  };
}
