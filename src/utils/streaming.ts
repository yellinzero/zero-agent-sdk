/**
 * Stream utilities for async iteration.
 */

/**
 * Merge multiple async iterables, yielding values as they arrive.
 * Similar to Promise.race but for async iterators.
 * Properly cleans up all inner iterators when the consumer breaks out.
 */
export async function* merge<T>(
  iterables: AsyncIterable<T>[],
  maxConcurrency: number = Infinity
): AsyncGenerator<T> {
  const iterators: Array<{
    iterator: AsyncIterator<T>;
    promise: Promise<{ value: T; done: boolean; index: number }>;
    index: number;
  }> = [];

  let activeCount = 0;
  let nextIndex = 0;

  function addIterator(iterable: AsyncIterable<T>) {
    const iterator = iterable[Symbol.asyncIterator]();
    const index = nextIndex++;
    const promise = iterator.next().then(({ value, done }) => ({
      value,
      done: done ?? false,
      index,
    }));
    iterators.push({ iterator, promise, index });
    activeCount++;
  }

  // Start initial batch
  const toStart = iterables.slice(0, maxConcurrency);
  const remaining = iterables.slice(maxConcurrency);

  for (const iterable of toStart) {
    addIterator(iterable);
  }

  try {
    while (iterators.length > 0) {
      const result = await Promise.race(iterators.map((it) => it.promise));
      const iteratorEntry = iterators.find((it) => it.index === result.index);

      if (!iteratorEntry) continue;

      if (result.done) {
        // Remove completed iterator
        const idx = iterators.indexOf(iteratorEntry);
        iterators.splice(idx, 1);
        activeCount--;

        // Start next from remaining
        if (remaining.length > 0) {
          addIterator(remaining.shift()!);
        }
      } else {
        yield result.value;

        // Queue next value from this iterator
        iteratorEntry.promise = iteratorEntry.iterator.next().then(({ value, done }) => ({
          value,
          done: done ?? false,
          index: iteratorEntry.index,
        }));
      }
    }
  } finally {
    // Clean up all remaining iterators when consumer breaks out
    await Promise.allSettled(iterators.map((entry) => entry.iterator.return?.()));
  }
}
