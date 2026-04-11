/**
 * Abort signal utilities.
 */

/**
 * Create a linked AbortController that aborts when any of the given signals abort.
 * Uses WeakRef to prevent memory leaks when parent controllers are long-lived.
 */
export function createLinkedAbortController(
  ...signals: (AbortSignal | undefined)[]
): AbortController {
  const controller = new AbortController();
  const filteredSignals = signals.filter((s): s is AbortSignal => s != null);

  // Increase maxListeners to avoid Node.js warnings in deep agent chains
  try {
    const { setMaxListeners } = require('node:events');
    setMaxListeners(50, controller.signal);
  } catch {
    // Node < 19 or non-Node environment
  }

  for (const signal of filteredSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller;
    }

    // Use WeakRef to prevent the parent signal from holding a strong reference
    // to the child controller, which would prevent GC of abandoned controllers
    const weakController = new WeakRef(controller);
    signal.addEventListener(
      'abort',
      () => {
        weakController.deref()?.abort(signal.reason);
      },
      { once: true, signal: controller.signal }
    );
  }

  return controller;
}

/**
 * Check if an error is an abort error.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

/**
 * Throw if the given signal is aborted.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }
}

/**
 * Sleep that rejects immediately when the given AbortSignal fires.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
