/**
 * TaskGet tool — retrieve a task by ID from the task store.
 */

import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';
import type { Task, TaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  taskId: z.string().describe('The ID of the task to retrieve'),
});

type TaskGetInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createTaskGetTool(store: TaskStore): SDKTool<TaskGetInput, Task | null> {
  return buildSDKTool({
    name: 'TaskGet',
    inputSchema,
    maxResultSizeChars: 5_000,

    async description() {
      return 'Retrieve a task by its ID to get full details including description and dependencies.';
    },

    async prompt() {
      return 'Use TaskGet with a specific task ID to view full details.';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    async call(input) {
      const task = await store.getTask(input.taskId);
      return { data: task };
    },

    mapToolResult(output, toolUseId) {
      if (!output) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'Task not found.',
          is_error: true,
        };
      }
      const lines = [
        `Task #${output.id}: ${output.subject}`,
        `Status: ${output.status}`,
        output.owner ? `Owner: ${output.owner}` : null,
        `Description: ${output.description}`,
        output.blocks.length > 0 ? `Blocks: ${output.blocks.join(', ')}` : null,
        output.blockedBy.length > 0 ? `Blocked by: ${output.blockedBy.join(', ')}` : null,
      ].filter(Boolean);
      return { type: 'tool_result', tool_use_id: toolUseId, content: lines.join('\n') };
    },
  });
}
