/**
 * AsyncQueue — a simple async iterable queue for pushing items from one
 * context and consuming them from another via for-await-of.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waitResolve: ((value: IteratorResult<T>) => void) | null = null;
  private waitReject: ((reason?: unknown) => void) | null = null;
  private closed = false;
  private failed: unknown = null;
  private consumerAttached = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      this.waitReject = null;
      resolve({ value: undefined as any, done: true });
    }
  }

  fail(error: unknown): void {
    this.closed = true;
    this.failed = error;
    if (this.waitReject) {
      const reject = this.waitReject;
      this.waitResolve = null;
      this.waitReject = null;
      reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.consumerAttached) {
      throw new Error('AsyncQueue supports only a single consumer.');
    }
    this.consumerAttached = true;
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.failed !== null) {
          return Promise.reject(this.failed);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waitResolve = resolve;
          this.waitReject = reject;
        });
      },
    };
  }
}
