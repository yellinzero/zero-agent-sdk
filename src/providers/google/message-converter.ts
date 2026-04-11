/**
 * Message converter: SDK ProviderMessage -> Google Content[]
 */

import type {
  ProviderContentBlock,
  ProviderMessage,
  ProviderToolSchema,
  SystemPromptBlock,
} from '../types.js';
import type {
  GoogleContent,
  GoogleFunctionDeclaration,
  GooglePart,
  GoogleTextPart,
  GoogleTool,
} from './types.js';

/**
 * Convert SDK messages to Google Content array.
 */
export function convertMessages(messages: ProviderMessage[]): GoogleContent[] {
  const result: GoogleContent[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: GooglePart[] = [];

    for (const block of msg.content) {
      const converted = convertContentBlock(block, msg.role);
      if (converted) {
        parts.push(...converted);
      }
    }

    if (parts.length > 0) {
      result.push({ role, parts });
    }
  }

  return result;
}

/**
 * Convert a single content block to Google parts.
 */
function convertContentBlock(block: ProviderContentBlock, role: string): GooglePart[] | null {
  switch (block.type) {
    case 'text':
      return [{ text: block.text }];

    case 'image':
      return [
        {
          inlineData: {
            mimeType: block.source.media_type,
            data: block.source.data,
          },
        },
      ];

    case 'tool_use':
      return [
        {
          functionCall: {
            name: block.name,
            args:
              typeof block.input === 'object' && block.input !== null
                ? (block.input as Record<string, unknown>)
                : { value: block.input },
          },
        },
      ];

    case 'tool_result': {
      const content =
        typeof block.content === 'string'
          ? block.content
          : block.content.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b))).join('\n');
      return [
        {
          functionResponse: {
            name: block.tool_use_id,
            response: { content },
          },
        },
      ];
    }

    case 'thinking':
    case 'redacted_thinking':
      // Skip thinking blocks
      return null;

    case 'document':
      return [{ text: '[Document content omitted — not directly supported by Google Gemini]' }];

    default:
      return null;
  }
}

/**
 * Convert system prompt to Google systemInstruction format.
 */
export function convertSystemPrompt(
  systemPrompt: string | SystemPromptBlock[]
): { parts: GoogleTextPart[] } | undefined {
  if (!systemPrompt) return undefined;

  const text =
    typeof systemPrompt === 'string' ? systemPrompt : systemPrompt.map((b) => b.text).join('\n\n');

  if (!text) return undefined;

  return { parts: [{ text }] };
}

/**
 * Convert SDK tool schemas to Google function declarations.
 */
export function convertTools(tools: ProviderToolSchema[]): GoogleTool[] {
  if (tools.length === 0) return [];

  const declarations: GoogleFunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  return [{ functionDeclarations: declarations }];
}
