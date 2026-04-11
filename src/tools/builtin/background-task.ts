/**
 * BackgroundTaskManager — manages background tasks for Agent, Bash, TaskStop, and TaskOutput tools.
 * Provides real task execution, abort support, output collection, and completion waiting.
 */

import type { ToolExecutionContext } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackgroundTask {
  id: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  abortController: AbortController;
  output: string[];
  result?: string;
  error?: string;
  promise: Promise<void>;
}

/**
 * Serializable snapshot of a background task (for session persistence).
 * Running tasks are marked as 'stopped' since they cannot be resumed.
 */
export interface SerializableTaskState {
  id: string;
  description: string;
  status: 'completed' | 'failed' | 'stopped';
  result?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// BackgroundTaskManager
// ---------------------------------------------------------------------------

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();

  /**
   * Register and start a background task.
   * The executor receives an AbortSignal and should return the final result string.
   */
  register(
    id: string,
    description: string,
    executor: (signal: AbortSignal) => Promise<string>
  ): void {
    const abortController = new AbortController();

    const task: BackgroundTask = {
      id,
      description,
      status: 'running',
      abortController,
      output: [],
      promise: Promise.resolve(), // Replaced below
    };

    task.promise = executor(abortController.signal)
      .then((result) => {
        task.result = result;
        task.status = 'completed';
        task.output.push(result);
      })
      .catch((err) => {
        if (abortController.signal.aborted) {
          task.status = 'stopped';
          task.error = 'Task was stopped';
        } else {
          task.status = 'failed';
          task.error = err instanceof Error ? err.message : String(err);
        }
      });

    this.tasks.set(id, task);
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Stop a running task by aborting its controller.
   * Returns true if the task was running and abort was signaled.
   */
  stop(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return false;
    task.abortController.abort();
    task.status = 'stopped';
    return true;
  }

  /**
   * Get the current output and status of a task.
   */
  getOutput(id: string): { status: string; output: string } {
    const task = this.tasks.get(id);
    if (!task) return { status: 'not_found', output: '' };
    return {
      status: task.status,
      output: task.result ?? task.error ?? task.output.join('\n'),
    };
  }

  /**
   * Wait for a task to complete, with optional timeout.
   */
  async waitForCompletion(id: string, timeoutMs?: number): Promise<void> {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return;

    if (timeoutMs !== undefined && timeoutMs > 0) {
      await Promise.race([
        task.promise,
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    } else {
      await task.promise;
    }
  }

  /**
   * Export task states for session persistence.
   * Running tasks are marked as 'stopped' since they cannot be resumed after restore.
   */
  toSerializable(): SerializableTaskState[] {
    return Array.from(this.tasks.values()).map((t) => ({
      id: t.id,
      description: t.description,
      status: t.status === 'running' ? ('stopped' as const) : t.status,
      result: t.result,
      error:
        t.error ?? (t.status === 'running' ? 'Task was interrupted by session restore' : undefined),
    }));
  }

  /**
   * Restore task states from a serialized snapshot.
   * Restored tasks are not running — only their final status/output is available.
   */
  static fromSerializable(states: SerializableTaskState[]): BackgroundTaskManager {
    const mgr = new BackgroundTaskManager();
    for (const s of states) {
      mgr.tasks.set(s.id, {
        id: s.id,
        description: s.description,
        status: s.status,
        abortController: new AbortController(),
        output: s.result ? [s.result] : [],
        result: s.result,
        error: s.error,
        promise: Promise.resolve(),
      });
    }
    return mgr;
  }
}

// ---------------------------------------------------------------------------
// Session-scoped singleton accessor
// ---------------------------------------------------------------------------

export const BG_MANAGER_KEY = '__backgroundTaskManager';

/**
 * Get or create a BackgroundTaskManager from the session state.
 * The manager is stored in session state so it persists across tool calls.
 */
export function getOrCreateBgManager(context: ToolExecutionContext): BackgroundTaskManager {
  const state = context.getState();
  if (state[BG_MANAGER_KEY] instanceof BackgroundTaskManager) {
    return state[BG_MANAGER_KEY];
  }
  const manager = new BackgroundTaskManager();
  context.setState((prev) => ({ ...prev, [BG_MANAGER_KEY]: manager }));
  return manager;
}
