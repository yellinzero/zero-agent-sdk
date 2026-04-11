/**
 * Tests for the retriever abstraction.
 */

import { describe, expect, it, vi } from 'vitest';
import { type Retriever, retrieverTool } from '../retrieval/types.js';

describe('retrieverTool', () => {
  it('should create a tool with correct defaults', () => {
    const mockRetriever: Retriever = {
      retrieve: vi.fn().mockResolvedValue([]),
    };

    const tool = retrieverTool(mockRetriever);
    expect(tool.name).toBe('retrieve');
    expect(tool.isReadOnly({} as any)).toBe(true);
    expect(tool.isConcurrencySafe({} as any)).toBe(true);
  });

  it('should accept custom name', () => {
    const mockRetriever: Retriever = {
      retrieve: vi.fn().mockResolvedValue([]),
    };

    const tool = retrieverTool(mockRetriever, { name: 'search_docs' });
    expect(tool.name).toBe('search_docs');
  });

  it('should call retriever and return documents', async () => {
    const mockRetriever: Retriever = {
      retrieve: vi.fn().mockResolvedValue([
        { id: 'doc-1', content: 'Hello world', score: 0.95 },
        { id: 'doc-2', content: 'Foo bar', score: 0.8 },
      ]),
    };

    const tool = retrieverTool(mockRetriever, { topK: 5 });
    const result = await tool.call({ query: 'hello' } as any, {} as any);

    expect(mockRetriever.retrieve).toHaveBeenCalledWith('hello', { topK: 5 });
    const data = result.data as any;
    expect(data.totalResults).toBe(2);
    expect(data.results[0].id).toBe('doc-1');
    expect(data.results[0].score).toBe(0.95);
  });

  it('should truncate long document content', async () => {
    const longContent = 'x'.repeat(10_000);
    const mockRetriever: Retriever = {
      retrieve: vi.fn().mockResolvedValue([{ id: 'doc-1', content: longContent }]),
    };

    const tool = retrieverTool(mockRetriever);
    const result = await tool.call({ query: 'test' } as any, {} as any);

    const data = result.data as any;
    expect(data.results[0].content.length).toBeLessThan(longContent.length);
    expect(data.results[0].content.endsWith('...')).toBe(true);
  });
});
