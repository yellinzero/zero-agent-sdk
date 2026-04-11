/**
 * TaskOutput tool — retrieve output from a running or completed task/agent.
 * Checks BackgroundTaskManager first for real background tasks,
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
  taskId: z.string().describe('The ID of the task to get output from'),
  block: z.boolean().optional().describe('Whether to wait for completion'),
  timeout: z.number().min(0).max(600_000).optional().describe('Max wait time in ms'),
});

type TaskOutputInput = z.infer<typeof inputSchema>;

interface TaskOutputResult {
  taskId: string;
  status: string;
  output?: string;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createTaskOutputTool(store: TaskStore): SDKTool<TaskOutputInput, TaskOutputResult> {
  return buildSDKTool({
    name: 'TaskOutput',
    inputSchema,
    maxResultSizeChars: 50_000,

    async description() {
      return 'Retrieves output from a running or completed task. Returns the task output along with status information.';
    },

    async prompt() {
      return 'Use TaskOutput to check on background tasks and retrieve their results.';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    async call(input, context) {
      // First check the background task manager for real background tasks
      const bgManager = getOrCreateBgManager(context);
      const bgTask = bgManager.get(input.taskId);
      if (bgTask) {
        if (input.block && bgTask.status === 'running') {
          await bgManager.waitForCompletion(input.taskId, input.timeout);
        }
        const output = bgManager.getOutput(input.taskId);
        return {
          data: {
            taskId: input.taskId,
            status: output.status,
            output: output.output || undefined,
          },
        };
      }

      // Fallback to task store — return output from metadata if available, else subject/description
      const task = await store.getTask(input.taskId);
      if (task) {
        const output =
          (task.metadata?.output as string | undefined) ?? task.subject ?? task.description;
        return {
          data: {
            taskId: input.taskId,
            status: task.status,
            output,
          },
        };
      }

      return {
        data: {
          taskId: input.taskId,
          status: 'not_found',
          output: undefined,
        },
      };
    },

    mapToolResult(output, toolUseId) {
      if (output.status === 'not_found') {
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `Task ${output.taskId} not found.`,
          is_error: true,
        };
      }
      const parts = [`Task ${output.taskId}: ${output.status}`];
      if (output.output) parts.push(output.output);
      return { type: 'tool_result', tool_use_id: toolUseId, content: parts.join('\n') };
    },
  });
}
