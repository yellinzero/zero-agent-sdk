/**
 * TaskStop tool — stop a running background task by ID.
 * Checks the BackgroundTaskManager first for real background tasks,
 * then falls back to the TaskStore.
 */

import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';
import { getOrCreateBgManager } from './background-task.js';
import type { TaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  taskId: z.string().describe('The ID of the background task to stop'),
});

type TaskStopInput = z.infer<typeof inputSchema>;

interface TaskStopResult {
  taskId: string;
  stopped: boolean;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createTaskStopTool(store: TaskStore): SDKTool<TaskStopInput, TaskStopResult> {
  return buildSDKTool({
    name: 'TaskStop',
    inputSchema,
    maxResultSizeChars: 2_000,

    async description() {
      return 'Stops a running background task by its ID.';
    },

    async prompt() {
      return 'Use TaskStop to terminate a long-running background task.';
    },

    isConcurrencySafe() {
      return false;
    },

    isReadOnly() {
      return false;
    },

    async call(input, context): Promise<{ data: TaskStopResult }> {
      // First check the background task manager for real running tasks
      const bgManager = getOrCreateBgManager(context);
      const bgTask = bgManager.get(input.taskId);
      if (bgTask && bgTask.status === 'running') {
        return { data: { taskId: input.taskId, stopped: bgManager.stop(input.taskId) } };
      }

      // Fallback to task store
      const task = await store.getTask(input.taskId);
      if (task && (task.status === 'in_progress' || task.status === 'pending')) {
        await store.updateTask(input.taskId, { status: 'stopped' });
        return { data: { taskId: input.taskId, stopped: true } };
      }

      return { data: { taskId: input.taskId, stopped: false } };
    },

    mapToolResult(output, toolUseId) {
      const content = output.stopped
        ? `Task ${output.taskId} stopped successfully.`
        : `Task ${output.taskId} could not be stopped (not found or not running).`;
      const result: {
        type: 'tool_result';
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      } = {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
      };
      if (!output.stopped) {
        result.is_error = true;
      }
      return result;
    },
  });
}
