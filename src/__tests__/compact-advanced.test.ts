/**
 * Advanced tests for the compact layer — media stripping, circuit breaker state,
 * failure/success tracking, and post-compact cleanup.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCompactCircuitState,
  postCompactCleanup,
  recordCompactFailure,
  recordCompactSuccess,
  stripMediaFromMessages,
} from '../context/compact.js';
import type { ProviderContentBlock, ProviderMessage } from '../providers/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textMsg(role: 'user' | 'assistant', text: string): ProviderMessage {
  return { role, content: [{ type: 'text', text }] };
}

function imageMsg(role: 'user' | 'assistant', data = 'base64data'): ProviderMessage {
  return {
    role,
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data },
      } as ProviderContentBlock,
    ],
  };
}

function documentMsg(role: 'user' | 'assistant', data = 'base64pdf'): ProviderMessage {
  return {
    role,
    content: [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data },
      } as ProviderContentBlock,
    ],
  };
}

function toolResultWithImageMsg(): ProviderMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tu-img-1',
        content: [
          { type: 'text', text: 'some text result' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img' } },
        ],
      } as ProviderContentBlock,
    ],
  };
}

// ---------------------------------------------------------------------------
// stripMediaFromMessages
// ---------------------------------------------------------------------------

describe('stripMediaFromMessages', () => {
  it('should replace image blocks with text placeholders', () => {
    // Group 1: image (will be unprotected), Group 2 & 3: text only (protected by keepRecentGroups=2)
    const messages: ProviderMessage[] = [
      imageMsg('user'), // Group 1 — unprotected
      textMsg('assistant', 'reply 1'),
      textMsg('user', 'second turn'), // Group 2 — protected
      textMsg('assistant', 'reply 2'),
      textMsg('user', 'third turn'), // Group 3 — protected
      textMsg('assistant', 'reply 3'),
    ];

    const { messages: result, strippedCount } = stripMediaFromMessages(messages, 2);

    expect(strippedCount).toBeGreaterThan(0);
    // The image block (index 0) should be replaced with a text placeholder
    const strippedBlock = result[0]!.content[0]!;
    expect(strippedBlock.type).toBe('text');
    expect((strippedBlock as { type: 'text'; text: string }).text).toContain(
      'Image removed for context compaction'
    );
  });

  it('should replace document blocks with text placeholders', () => {
    const messages: ProviderMessage[] = [
      documentMsg('user'),
      textMsg('assistant', 'reply 1'),
      textMsg('user', 'next turn'),
      textMsg('assistant', 'reply 2'),
    ];

    const { messages: result, strippedCount } = stripMediaFromMessages(messages, 1);

    expect(strippedCount).toBeGreaterThan(0);
    const strippedBlock = result[0]!.content[0]!;
    expect(strippedBlock.type).toBe('text');
    expect((strippedBlock as { type: 'text'; text: string }).text).toContain(
      'Document removed for context compaction'
    );
  });

  it('should replace images inside tool_result content arrays', () => {
    const messages: ProviderMessage[] = [
      textMsg('user', 'do something'),
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu-img-1',
            name: 'screenshot',
            input: {},
          } as ProviderContentBlock,
        ],
      },
      toolResultWithImageMsg(),
      textMsg('user', 'next turn'),
      textMsg('assistant', 'reply'),
    ];

    const { messages: result, strippedCount } = stripMediaFromMessages(messages, 1);

    expect(strippedCount).toBeGreaterThan(0);
    const toolBlock = result[2]!.content[0] as any;
    expect(toolBlock.type).toBe('tool_result');
    const imageReplacement = toolBlock.content.find(
      (c: any) => c.type === 'text' && c.text.includes('Image removed')
    );
    expect(imageReplacement).toBeDefined();
  });

  it('should preserve media in recent protected groups', () => {
    // Single group — all messages are protected
    const messages: ProviderMessage[] = [imageMsg('user', 'keep-me')];

    const { messages: result, strippedCount } = stripMediaFromMessages(messages, 2);

    expect(strippedCount).toBe(0);
    expect(result[0]!.content[0]!.type).toBe('image');
  });

  it('should return strippedCount of 0 for empty messages', () => {
    const { messages: result, strippedCount } = stripMediaFromMessages([]);

    expect(result).toEqual([]);
    expect(strippedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CompactCircuitState — createCompactCircuitState
// ---------------------------------------------------------------------------

describe('createCompactCircuitState', () => {
  it('should return initial state with zero failures and closed circuit', () => {
    const state = createCompactCircuitState();

    expect(state.consecutiveFailures).toBe(0);
    expect(state.isOpen).toBe(false);
    expect(state.openedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recordCompactFailure
// ---------------------------------------------------------------------------

describe('recordCompactFailure', () => {
  it('should increment consecutive failures', () => {
    const initial = createCompactCircuitState();
    const after1 = recordCompactFailure(initial);
    const after2 = recordCompactFailure(after1);

    expect(after1.consecutiveFailures).toBe(1);
    expect(after2.consecutiveFailures).toBe(2);
  });

  it('should not mutate the input state', () => {
    const initial = createCompactCircuitState();
    const next = recordCompactFailure(initial);

    expect(initial.consecutiveFailures).toBe(0);
    expect(next.consecutiveFailures).toBe(1);
  });

  it('should keep isOpen false when below threshold', () => {
    const state = recordCompactFailure(createCompactCircuitState());

    expect(state.consecutiveFailures).toBe(1);
    expect(state.isOpen).toBe(false);
    expect(state.openedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recordCompactSuccess
// ---------------------------------------------------------------------------

describe('recordCompactSuccess', () => {
  it('should reset consecutive failures to zero', () => {
    let state = createCompactCircuitState();
    state = recordCompactFailure(state);
    state = recordCompactFailure(state);
    expect(state.consecutiveFailures).toBe(2);

    const reset = recordCompactSuccess(state);
    expect(reset.consecutiveFailures).toBe(0);
    expect(reset.isOpen).toBe(false);
    expect(reset.openedAt).toBeNull();
  });

  it('should close the circuit after it was opened', () => {
    let state = createCompactCircuitState();
    // Open the circuit
    state = recordCompactFailure(state);
    state = recordCompactFailure(state);
    state = recordCompactFailure(state);
    expect(state.isOpen).toBe(true);

    // Success resets it
    const reset = recordCompactSuccess(state);
    expect(reset.isOpen).toBe(false);
    expect(reset.consecutiveFailures).toBe(0);
    expect(reset.openedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker — opens after 3 consecutive failures
// ---------------------------------------------------------------------------

describe('Circuit breaker', () => {
  it('should open after 3 consecutive failures', () => {
    let state = createCompactCircuitState();
    state = recordCompactFailure(state);
    expect(state.isOpen).toBe(false);

    state = recordCompactFailure(state);
    expect(state.isOpen).toBe(false);

    state = recordCompactFailure(state);
    expect(state.isOpen).toBe(true);
    expect(state.consecutiveFailures).toBe(3);
    expect(state.openedAt).toBeTypeOf('number');
    expect(state.openedAt).toBeGreaterThan(0);
  });

  it('should remain open on further failures', () => {
    let state = createCompactCircuitState();
    for (let i = 0; i < 5; i++) {
      state = recordCompactFailure(state);
    }

    expect(state.isOpen).toBe(true);
    expect(state.consecutiveFailures).toBe(5);
  });

  it('should record openedAt timestamp when circuit first opens', () => {
    const now = Date.now();
    let state = createCompactCircuitState();
    state = recordCompactFailure(state);
    state = recordCompactFailure(state);
    state = recordCompactFailure(state); // Opens here

    expect(state.openedAt).not.toBeNull();
    // Should be a reasonable timestamp (within last second)
    expect(state.openedAt!).toBeGreaterThanOrEqual(now);
  });
});

// ---------------------------------------------------------------------------
// postCompactCleanup
// ---------------------------------------------------------------------------

describe('postCompactCleanup', () => {
  it('should clear readFileState map', () => {
    const readFileState = new Map<string, unknown>([
      ['file1.ts', { content: '...' }],
      ['file2.ts', { content: '...' }],
    ]);
    const messages: ProviderMessage[] = [textMsg('user', 'hello')];

    postCompactCleanup(
      messages,
      'A sufficiently long summary that exceeds two hundred characters. '.repeat(4),
      {
        readFileState,
      }
    );

    expect(readFileState.size).toBe(0);
  });

  it('should call onCompactComplete with messages and summary', () => {
    const onCompactComplete = vi.fn();
    const messages: ProviderMessage[] = [textMsg('user', 'hello')];
    const summary = 'x'.repeat(250);

    postCompactCleanup(messages, summary, { onCompactComplete });

    expect(onCompactComplete).toHaveBeenCalledOnce();
    expect(onCompactComplete).toHaveBeenCalledWith({ messages, summary });
  });

  it('should clear readFileState and call onCompactComplete together', () => {
    const readFileState = new Map<string, unknown>([['a', 1]]);
    const onCompactComplete = vi.fn();
    const messages: ProviderMessage[] = [textMsg('assistant', 'done')];
    const summary = 'y'.repeat(250);

    const { isLowQuality } = postCompactCleanup(messages, summary, {
      readFileState,
      onCompactComplete,
    });

    expect(readFileState.size).toBe(0);
    expect(onCompactComplete).toHaveBeenCalledOnce();
    expect(isLowQuality).toBe(false);
  });

  it('should flag low quality when summary is under 200 characters', () => {
    const messages: ProviderMessage[] = [textMsg('user', 'hi')];
    const shortSummary = 'Short.';

    const { isLowQuality } = postCompactCleanup(messages, shortSummary);

    expect(isLowQuality).toBe(true);
  });

  it('should not flag low quality when summary is 200+ characters', () => {
    const messages: ProviderMessage[] = [textMsg('user', 'hi')];
    const longSummary = 'z'.repeat(200);

    const { isLowQuality } = postCompactCleanup(messages, longSummary);

    expect(isLowQuality).toBe(false);
  });

  it('should work without options (no readFileState, no callback)', () => {
    const messages: ProviderMessage[] = [textMsg('user', 'hi')];

    const { messages: returned, isLowQuality } = postCompactCleanup(messages, 'x'.repeat(300));

    expect(returned).toBe(messages);
    expect(isLowQuality).toBe(false);
  });
});
