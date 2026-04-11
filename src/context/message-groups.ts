/**
 * Message grouping utilities — groups messages by API round (turn).
 * Ensures tool_use/tool_result pairs are never split across groups.
 */

import type { ProviderMessage } from '../providers/types.js';
import { estimateMessagesTokenCount } from '../utils/tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageGroup {
  messages: ProviderMessage[];
  tokenCount: number;
  hasToolUse: boolean;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Group messages by API round.
 *
 * Rules:
 * 1. A new group starts when a user message does NOT contain tool_result blocks.
 * 2. An assistant message + the following user message with tool_result stays in the same group.
 * 3. tool_use / tool_result pairs are never split.
 */
export function groupMessagesByApiRound(messages: ProviderMessage[]): MessageGroup[] {
  if (messages.length === 0) return [];

  const groups: MessageGroup[] = [];
  let currentGroup: ProviderMessage[] = [];

  for (const msg of messages) {
    const hasToolResult = msg.role === 'user' && msg.content.some((b) => b.type === 'tool_result');

    if (msg.role === 'user' && !hasToolResult && currentGroup.length > 0) {
      // New user message without tool_result — start a new group
      groups.push(buildGroup(currentGroup));
      currentGroup = [msg];
    } else {
      currentGroup.push(msg);
    }
  }

  // Push the last group
  if (currentGroup.length > 0) {
    groups.push(buildGroup(currentGroup));
  }

  return groups;
}

function buildGroup(messages: ProviderMessage[]): MessageGroup {
  return {
    messages,
    tokenCount: estimateMessagesTokenCount(messages),
    hasToolUse: messages.some((m) => m.content.some((b) => b.type === 'tool_use')),
  };
}
