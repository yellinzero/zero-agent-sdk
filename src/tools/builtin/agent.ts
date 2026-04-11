/**
 * Agent tool — delegates complex tasks to child agents.
 * The user provides a createChildAgent callback to avoid circular dependencies.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';
import { getOrCreateBgManager } from './background-task.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChildAgentResult {
  agentId: string;
  result?: string;
}

export interface AgentToolOptions {
  /** Callback to create and run a child agent */
  createChildAgent: (options: {
    description: string;
    prompt: string;
    isolation?: 'worktree';
    signal?: AbortSignal;
  }) => Promise<ChildAgentResult>;
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  description: z.string().describe('A short (3-5 word) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
  run_in_background: z
    .boolean()
    .optional()
    .describe('Set to true to run this agent in the background'),
  isolation: z
    .enum(['worktree'])
    .optional()
    .describe('Isolation mode. "worktree" creates a temporary git worktree.'),
});

type AgentInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createAgentTool(options: AgentToolOptions): SDKTool<AgentInput, ChildAgentResult> {
  return buildSDKTool({
    name: 'Agent',
    inputSchema,
    maxResultSizeChars: 50_000,

    async description() {
      return 'Launch a new agent to handle complex, multi-step tasks autonomously. Each agent can use tools and work independently.';
    },

    async prompt() {
      return [
        'Use the Agent tool for complex tasks that benefit from autonomous execution.',
        '- Always include a short description summarizing what the agent will do.',
        '- Launch multiple agents concurrently when tasks are independent.',
        '- Use run_in_background for tasks where you do not need immediate results.',
      ].join('\n');
    },

    isConcurrencySafe() {
      return false;
    },

    isReadOnly() {
      return false;
    },

    async checkPermissions(input) {
      return {
        behavior: 'ask' as const,
        message: `Spawn sub-agent: ${input.description}`,
      };
    },

    async call(input, context) {
      if (input.run_in_background) {
        const taskId = randomUUID();
        const bgManager = getOrCreateBgManager(context);
        bgManager.register(taskId, input.description, async (signal) => {
          const result = await options.createChildAgent({
            description: input.description,
            prompt: input.prompt,
            isolation: input.isolation,
            signal,
          });
          return result.result ?? '';
        });
        return { data: { agentId: taskId, result: undefined } };
      }

      // Foreground mode — run synchronously
      const result = await options.createChildAgent({
        description: input.description,
        prompt: input.prompt,
        isolation: input.isolation,
      });

      return { data: result };
    },

    mapToolResult(output, toolUseId) {
      const content = output.result ?? `Agent ${output.agentId} launched.`;
      return { type: 'tool_result', tool_use_id: toolUseId, content };
    },
  });
}
