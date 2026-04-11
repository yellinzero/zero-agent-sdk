/**
 * TaskList tool — list all tasks in the task store.
 */

import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';
import type { Task, TaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({});

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createTaskListTool(store: TaskStore): SDKTool<Record<string, never>, Task[]> {
  return buildSDKTool({
    name: 'TaskList',
    inputSchema,
    maxResultSizeChars: 10_000,

    async description() {
      return 'List all tasks in the task list to see what is available, check progress, or find unblocked work.';
    },

    async prompt() {
      return 'Use TaskList to see all tasks and their statuses.';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    async call() {
      const tasks = await store.listTasks();
      return { data: tasks };
    },

    mapToolResult(output, toolUseId) {
      if (output.length === 0) {
        return { type: 'tool_result', tool_use_id: toolUseId, content: 'No tasks found.' };
      }
      const lines = output.map((t) => {
        const blocked = t.blockedBy.length > 0 ? ` [blocked by: ${t.blockedBy.join(', ')}]` : '';
        const owner = t.owner ? ` (owner: ${t.owner})` : '';
        return `#${t.id} [${t.status}] ${t.subject}${owner}${blocked}`;
      });
      return { type: 'tool_result', tool_use_id: toolUseId, content: lines.join('\n') };
    },
  });
}
