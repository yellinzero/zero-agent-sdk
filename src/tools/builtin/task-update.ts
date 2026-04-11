/**
 * TaskUpdate tool — update an existing task in the task store.
 */

import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';
import type { Task, TaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  taskId: z.string().describe('The ID of the task to update'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'deleted'])
    .optional()
    .describe('New status for the task'),
  subject: z.string().optional().describe('New subject for the task'),
  description: z.string().optional().describe('New description for the task'),
  activeForm: z
    .string()
    .optional()
    .describe('Present continuous form shown in spinner when in_progress'),
  owner: z.string().optional().describe('New owner for the task'),
  addBlocks: z.array(z.string()).optional().describe('Task IDs that this task blocks'),
  addBlockedBy: z.array(z.string()).optional().describe('Task IDs that block this task'),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Metadata keys to merge into the task. Set a key to null to delete it.'),
});

type TaskUpdateInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createTaskUpdateTool(store: TaskStore): SDKTool<TaskUpdateInput, Task | null> {
  return buildSDKTool({
    name: 'TaskUpdate',
    inputSchema,
    maxResultSizeChars: 5_000,

    async description() {
      return 'Update a task in the task list — change status, details, or dependencies.';
    },

    async prompt() {
      return 'Use TaskUpdate to mark tasks as in_progress, completed, or deleted, and to manage dependencies.';
    },

    isConcurrencySafe() {
      return false;
    },

    isReadOnly() {
      return false;
    },

    async call(input) {
      // Handle deletion
      if (input.status === 'deleted') {
        await store.deleteTask(input.taskId);
        return { data: null };
      }

      const updates: Record<string, unknown> = {};
      if (input.status !== undefined) updates.status = input.status;
      if (input.subject !== undefined) updates.subject = input.subject;
      if (input.description !== undefined) updates.description = input.description;
      if (input.owner !== undefined) updates.owner = input.owner;
      if (input.activeForm !== undefined) updates.activeForm = input.activeForm;
      if (input.metadata !== undefined) updates.metadata = input.metadata;

      const task = await store.updateTask(input.taskId, updates);

      if (input.addBlocks) {
        await store.addBlocks(input.taskId, input.addBlocks);
      }
      if (input.addBlockedBy) {
        await store.addBlockedBy(input.taskId, input.addBlockedBy);
      }

      return { data: task };
    },

    mapToolResult(output, toolUseId) {
      if (!output) {
        return { type: 'tool_result', tool_use_id: toolUseId, content: 'Task deleted.' };
      }
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: `Updated task #${output.id} status`,
      };
    },
  });
}
