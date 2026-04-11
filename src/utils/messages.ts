/**
 * Message utility functions.
 */

import type {
  ProviderContentBlock,
  ProviderMessage,
  ProviderToolResultBlock,
  ProviderToolUseBlock,
} from '../providers/types.js';

/**
 * Create a user message.
 */
export function createUserMessage(text: string): ProviderMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  };
}

/**
 * Create an assistant message.
 */
export function createAssistantMessage(text: string): ProviderMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  };
}

/**
 * Create a tool result message.
 */
export function createToolResultMessage(
  toolUseId: string,
  content: string,
  isError: boolean = false
): ProviderMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        is_error: isError,
      },
    ],
  };
}

/**
 * Extract text content from a message.
 */
export function extractText(message: ProviderMessage): string {
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Extract tool use blocks from a message.
 */
export function extractToolUseBlocks(
  message: ProviderMessage
): Array<{ id: string; name: string; input: unknown }> {
  return message.content
    .filter((b): b is ProviderToolUseBlock => b.type === 'tool_use')
    .map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));
}

/**
 * Check if a message contains tool use blocks.
 */
export function hasToolUse(message: ProviderMessage): boolean {
  return message.content.some((b) => b.type === 'tool_use');
}

/**
 * Normalize messages to ensure proper turn alternation for API calls.
 * Some providers require strict user/assistant alternation.
 */
export function normalizeMessageOrder(messages: ProviderMessage[]): ProviderMessage[] {
  if (messages.length === 0) return [];

  const result: ProviderMessage[] = [];

  for (const msg of messages) {
    const lastMsg = result[result.length - 1];

    if (lastMsg && lastMsg.role === msg.role) {
      // Merge consecutive same-role messages
      lastMsg.content = [...lastMsg.content, ...msg.content];
    } else {
      result.push({ ...msg, content: [...msg.content] });
    }
  }

  return result;
}

/**
 * Create synthetic tool_result blocks for any tool_use blocks in the last
 * assistant message that don't have matching tool_result in subsequent messages.
 *
 * Returns an empty array if no synthetic results are needed.
 */
export function createMissingToolResults(
  messages: ProviderMessage[],
  errorMsg = 'Tool execution was interrupted.'
): ProviderToolResultBlock[] {
  if (messages.length === 0) return [];

  // Find the last assistant message
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return [];

  const assistantMsg = messages[lastAssistantIdx]!;
  const toolUseIds = new Set<string>();
  for (const block of assistantMsg.content) {
    if (block.type === 'tool_use') {
      toolUseIds.add(block.id);
    }
  }

  if (toolUseIds.size === 0) return [];

  // Check subsequent messages for existing tool_results
  for (let i = lastAssistantIdx + 1; i < messages.length; i++) {
    for (const block of messages[i]!.content) {
      if (block.type === 'tool_result') {
        toolUseIds.delete(block.tool_use_id);
      }
    }
  }

  // Generate synthetic results for remaining unmatched tool_use IDs
  const results: ProviderToolResultBlock[] = [];
  for (const id of toolUseIds) {
    results.push({
      type: 'tool_result',
      tool_use_id: id,
      content: errorMsg,
      is_error: true,
    });
  }

  return results;
}
