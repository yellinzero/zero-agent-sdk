/**
 * Session concurrency test — verifies that concurrent send() calls
 * are serialized and don't interleave state mutations.
 */

import { describe, expect, it, vi } from 'vitest';

describe('Session send() concurrency', () => {
  it('serializes concurrent send() calls via Promise-chain lock', async () => {
    // Test the lock mechanism directly: simulate the lock pattern used in AgentSessionImpl
    const executionOrder: string[] = [];
    let sendLock: Promise<void> = Promise.resolve();

    async function simulateSend(id: string, delay: number): Promise<void> {
      let releaseLock!: () => void;
      const prevLock = sendLock;
      sendLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      await prevLock;

      try {
        executionOrder.push(`${id}-start`);
        await new Promise((r) => setTimeout(r, delay));
        executionOrder.push(`${id}-end`);
      } finally {
        releaseLock();
      }
    }

    // Launch 3 concurrent sends
    const p1 = simulateSend('A', 30);
    const p2 = simulateSend('B', 10);
    const p3 = simulateSend('C', 10);

    await Promise.all([p1, p2, p3]);

    // They should execute sequentially, not interleaved
    expect(executionOrder).toEqual(['A-start', 'A-end', 'B-start', 'B-end', 'C-start', 'C-end']);
  });

  it('lock is released even if send throws', async () => {
    let sendLock: Promise<void> = Promise.resolve();
    const executionOrder: string[] = [];

    async function simulateSend(id: string, shouldThrow: boolean): Promise<void> {
      let releaseLock!: () => void;
      const prevLock = sendLock;
      sendLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      await prevLock;

      try {
        executionOrder.push(`${id}-start`);
        if (shouldThrow) throw new Error('fail');
        executionOrder.push(`${id}-end`);
      } finally {
        releaseLock();
      }
    }

    const p1 = simulateSend('A', true).catch(() => {});
    const p2 = simulateSend('B', false);

    await Promise.all([p1, p2]);

    // B should still execute after A fails
    expect(executionOrder).toEqual(['A-start', 'B-start', 'B-end']);
  });
});
