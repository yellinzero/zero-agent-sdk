/**
 * TaskCreate tool — create a new task in the task store.
 */

import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';
import type { Task, TaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  subject: z.string().describe('A brief title for the task'),
  description: z.string().describe('A detailed description of what needs to be done'),
  activeForm: z
    .string()
    .optional()
    .describe('Present continuous form shown in spinner when in_progress'),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Arbitrary metadata to attach to the task'),
});

type TaskCreateInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createTaskCreateTool(store: TaskStore): SDKTool<TaskCreateInput, Task> {
  return buildSDKTool({
    name: 'TaskCreate',
    inputSchema,
    maxResultSizeChars: 5_000,

    async description() {
      return 'Create a structured task to track progress during a coding session.';
    },

    async prompt() {
      return 'Use TaskCreate for complex multi-step tasks that benefit from progress tracking.';
    },

    isConcurrencySafe() {
      return false;
    },

    isReadOnly() {
      return false;
    },

    async call(input) {
      const task = await store.createTask({
        subject: input.subject,
        description: input.description,
        status: 'pending',
        activeForm: input.activeForm,
        metadata: input.metadata ?? {},
      });
      return { data: task };
    },

    mapToolResult(output, toolUseId) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: `Task #${output.id} created successfully: ${output.subject}`,
      };
    },
  });
}
