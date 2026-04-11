/**
 * Tool result size enforcement — truncates oversized tool results and provides
 * empty result placeholders to prevent context window overflow.
 *
 * IMPORTANT: This should be called AFTER mapToolResult() to avoid destroying
 * structured data that the mapping function needs.
 */

import type { ProviderContentBlock } from '../providers/types.js';

/**
 * Enforce a character limit on tool result data.
 * - Empty/null/undefined results get a descriptive placeholder.
 * - Results exceeding maxChars are truncated with a notice.
 *
 * When `preserveStructure` is true, structured objects are not stringified
 * before checking — only string results are truncated. This allows
 * mapToolResult() to receive the original structured data.
 */
export function enforceResultLimit(
  data: unknown,
  toolName: string,
  maxChars: number,
  options?: { preserveStructure?: boolean }
): { data: unknown; wasTruncated: boolean } {
  // Empty result placeholder
  if (data === undefined || data === null || data === '') {
    return { data: `(${toolName} completed with no output)`, wasTruncated: false };
  }

  if (maxChars === Infinity || maxChars <= 0) {
    return { data, wasTruncated: false };
  }

  // When preserveStructure is true, only truncate strings — leave objects
  // intact so mapToolResult can process the full structured data
  if (options?.preserveStructure && typeof data !== 'string') {
    return { data, wasTruncated: false };
  }

  const str = typeof data === 'string' ? data : JSON.stringify(data);
  if (str.length <= maxChars) {
    return { data, wasTruncated: false };
  }

  const truncated = str.slice(0, maxChars);
  return {
    data: `${truncated}\n\n... [Truncated: ${str.length} chars, limit ${maxChars}]`,
    wasTruncated: true,
  };
}

/**
 * Enforce a character limit on the final mapped tool result content.
 * This is applied AFTER mapToolResult() on the string content that
 * will be sent to the model.
 */
export function enforceContentLimit(
  content: string,
  toolName: string,
  maxChars: number
): { content: string; wasTruncated: boolean } {
  if (maxChars === Infinity || maxChars <= 0 || content.length <= maxChars) {
    return { content, wasTruncated: false };
  }

  const truncated = content.slice(0, maxChars);
  return {
    content: `${truncated}\n\n... [Truncated: ${content.length} chars, limit ${maxChars}]`,
    wasTruncated: true,
  };
}

/**
 * Enforce a size limit on multimodal (non-string) tool result content.
 * Replaces oversized image/document blocks with text placeholders.
 */
export function enforceMultimodalLimit(
  content: ProviderContentBlock[],
  toolName: string,
  maxChars: number
): { content: ProviderContentBlock[]; wasTruncated: boolean } {
  if (maxChars === Infinity || maxChars <= 0) {
    return { content, wasTruncated: false };
  }

  let totalSize = 0;
  const result: ProviderContentBlock[] = [];
  let wasTruncated = false;

  for (const block of content) {
    if (
      (block.type === 'image' || block.type === 'document') &&
      'source' in block &&
      block.source?.data
    ) {
      const dataSize = block.source.data.length;
      if (totalSize + dataSize > maxChars) {
        result.push({
          type: 'text',
          text: `[${block.type} removed: ${Math.round(dataSize / 1024)}KB exceeded budget for ${toolName}]`,
        } as ProviderContentBlock);
        wasTruncated = true;
        continue;
      }
      totalSize += dataSize;
    } else if (block.type === 'text' && 'text' in block) {
      const textSize = (block as { text: string }).text.length;
      if (totalSize + textSize > maxChars) {
        const remaining = Math.max(0, maxChars - totalSize);
        result.push({
          type: 'text',
          text: `${(block as { text: string }).text.slice(0, remaining)}\n\n... [Truncated: ${textSize} chars, limit ${maxChars}]`,
        } as ProviderContentBlock);
        wasTruncated = true;
        totalSize = maxChars;
        continue;
      }
      totalSize += textSize;
    }
    result.push(block);
  }

  return { content: result, wasTruncated };
}
