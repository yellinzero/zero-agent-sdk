/**
 * WebSearch tool — delegates to a user-provided search function.
 * Provider-agnostic: the user supplies their own search backend (SerpAPI, Brave, Tavily, etc.).
 */

import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearchToolOptions {
  /** The search function to delegate to */
  searchFn: (
    query: string,
    options?: {
      allowedDomains?: string[];
      blockedDomains?: string[];
    }
  ) => Promise<WebSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  query: z.string().min(2).describe('The search query to use'),
  allowed_domains: z
    .array(z.string())
    .optional()
    .describe('Only include search results from these domains'),
  blocked_domains: z
    .array(z.string())
    .optional()
    .describe('Never include search results from these domains'),
});

type WebSearchInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createWebSearchTool(
  options: WebSearchToolOptions
): SDKTool<WebSearchInput, WebSearchResult[]> {
  return buildSDKTool({
    name: 'WebSearch',
    inputSchema,
    maxResultSizeChars: 30_000,

    async description() {
      return 'Searches the web and returns results to inform responses. Provides up-to-date information for current events and recent data.';
    },

    async prompt() {
      return 'Use WebSearch to find up-to-date information from the web.';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    async checkPermissions() {
      return { behavior: 'allow' as const };
    },

    async call(input) {
      const results = await options.searchFn(input.query, {
        allowedDomains: input.allowed_domains,
        blockedDomains: input.blocked_domains,
      });
      return { data: results };
    },

    mapToolResult(output, toolUseId) {
      if (output.length === 0) {
        return { type: 'tool_result', tool_use_id: toolUseId, content: 'No results found.' };
      }
      const text = output
        .map((r, i) => `${i + 1}. [${r.title}](${r.url})${r.snippet ? `\n   ${r.snippet}` : ''}`)
        .join('\n');
      return { type: 'tool_result', tool_use_id: toolUseId, content: text };
    },
  });
}
