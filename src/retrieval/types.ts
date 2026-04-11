/**
 * Retriever abstraction — interface for document retrieval and a
 * factory function to wrap any Retriever as an SDKTool.
 */

import { z } from 'zod';
import type { SDKTool } from '../tools/types.js';
import { buildSDKTool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Document {
  /** Unique document identifier */
  id: string;
  /** Document content (text) */
  content: string;
  /** Relevance score (0-1, higher is better) */
  score?: number;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface RetrievalOptions {
  /** Maximum number of documents to return */
  topK?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Filter by metadata fields */
  filter?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Retriever Interface
// ---------------------------------------------------------------------------

export interface Retriever {
  /** Retrieve documents matching a query */
  retrieve(query: string, options?: RetrievalOptions): Promise<Document[]>;
}

// ---------------------------------------------------------------------------
// retrieverTool — wrap a Retriever as SDKTool
// ---------------------------------------------------------------------------

/**
 * Wrap a Retriever as an SDKTool for agent use.
 */
export function retrieverTool(
  retriever: Retriever,
  options?: { name?: string; description?: string; topK?: number }
): SDKTool {
  const name = options?.name ?? 'retrieve';
  const desc = options?.description ?? 'Search and retrieve relevant documents.';
  const defaultTopK = options?.topK ?? 10;

  return buildSDKTool({
    name,
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      topK: z.number().optional().describe('Maximum number of results'),
    }),
    maxResultSizeChars: 100_000,

    async call(args) {
      const docs = await retriever.retrieve(args.query, {
        topK: args.topK ?? defaultTopK,
      });

      return {
        data: {
          results: docs.map((d) => ({
            id: d.id,
            content: d.content.length > 5000 ? `${d.content.slice(0, 5000)}...` : d.content,
            score: d.score,
            metadata: d.metadata,
          })),
          totalResults: docs.length,
        },
      };
    },

    async description() {
      return desc;
    },

    async prompt() {
      return desc;
    },

    isConcurrencySafe: () => true,
    isReadOnly: () => true,
  });
}
