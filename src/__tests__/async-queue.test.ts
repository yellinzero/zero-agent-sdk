import { describe, expect, it } from 'vitest';
import { AsyncQueue } from '../utils/async-queue.js';

describe('AsyncQueue', () => {
  it('rejects multiple concurrent consumers', async () => {
    const queue = new AsyncQueue<number>();
    const iteratorA = queue[Symbol.asyncIterator]();
    expect(() => queue[Symbol.asyncIterator]()).toThrow(/single consumer/i);
    queue.push(1);
    await expect(iteratorA.next()).resolves.toEqual({ value: 1, done: false });
  });
});
