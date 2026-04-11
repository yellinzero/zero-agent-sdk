/**
 * Agent delegation — factory functions for creating child agent tools.
 *
 * Two modes:
 * - Standard delegation (via `delegateTool`): Creates a child agent with isolated context
 * - Fork delegation: Inherits parent context for prompt cache sharing
 */

import { z } from 'zod';
import type { AgentConfig, AgentResult } from '../core/agent.js';
import type { SDKTool, SDKToolResult } from '../tools/types.js';
import { buildSDKTool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  /** Unique name for this agent type */
  name: string;
  /** Description of what this agent does */
  description: string;
  /** System prompt for the child agent */
  systemPrompt?: string;
  /** Tools available to the child agent (defaults to parent's tools) */
  tools?: SDKTool[];
  /** Model to use (defaults to parent's model) */
  model?: string;
  /** Max turns for the child agent */
  maxTurns?: number;
}

export interface DelegateToolOptions {
  /** Available agent definitions */
  agents?: AgentDefinition[];
  /** Factory to create and run a child agent */
  runAgent: (options: {
    definition?: AgentDefinition;
    prompt: string;
    parentConfig: AgentConfig;
    isolation?: 'worktree';
  }) => Promise<AgentResult>;
  /** Parent agent configuration (for inheriting settings) */
  parentConfig: AgentConfig;
  /** Maximum recursion depth (default: 3) */
  maxDepth?: number;
}

// ---------------------------------------------------------------------------
// delegateTool — convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a delegation tool that spawns child agents.
 * This is the recommended way to enable agent-to-agent delegation.
 *
 * @example
 * ```ts
 * const agent = createAgent({
 *   tools: [
 *     delegateTool({
 *       parentConfig: config,
 *       runAgent: async ({ prompt, parentConfig }) => {
 *         const child = createAgent({ ...parentConfig, systemPrompt: 'You are a helper.' });
 *         return child.run(prompt);
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export function delegateTool(options: DelegateToolOptions): SDKTool {
  const maxDepth = options.maxDepth ?? 3;

  const agentTypeEnum = options.agents?.length
    ? z.enum(options.agents.map((a) => a.name) as [string, ...string[]]).optional()
    : z.string().optional();

  return buildSDKTool({
    name: 'Agent',
    inputSchema: z.object({
      description: z.string().describe('Short (3-5 word) description of the task'),
      prompt: z.string().describe('Detailed task for the child agent'),
      subagent_type: agentTypeEnum.describe('Type of agent to use'),
      isolation: z.enum(['worktree']).optional().describe('Isolation mode'),
    }),
    maxResultSizeChars: 50_000,

    async description() {
      return 'Delegate a task to a child agent for autonomous execution.';
    },

    async prompt() {
      const lines = [
        'Use the Agent tool to delegate complex, multi-step tasks.',
        '- Provide a clear, detailed prompt so the agent can work autonomously.',
        '- Use isolation: "worktree" for tasks that modify files.',
      ];

      if (options.agents?.length) {
        lines.push('', 'Available agent types:');
        for (const agent of options.agents) {
          lines.push(`- ${agent.name}: ${agent.description}`);
        }
      }

      return lines.join('\n');
    },

    isConcurrencySafe: () => false,
    isReadOnly: () => false,

    async checkPermissions(input) {
      return {
        behavior: 'ask' as const,
        message: `Spawn child agent: ${(input as { description: string }).description}`,
      };
    },

    async call(input, context): Promise<SDKToolResult<unknown>> {
      // Recursion guard
      const currentDepth = (context.getState().delegationDepth as number) ?? 0;
      if (currentDepth >= maxDepth) {
        return {
          data: `Error: Maximum delegation depth (${maxDepth}) reached. Cannot spawn more child agents.`,
        };
      }

      const typedInput = input as {
        description: string;
        prompt: string;
        subagent_type?: string;
        isolation?: 'worktree';
      };

      // Find matching agent definition
      const definition = typedInput.subagent_type
        ? options.agents?.find((a) => a.name === typedInput.subagent_type)
        : options.agents?.[0];

      try {
        // Update delegation depth in state
        context.setState((prev) => ({
          ...prev,
          delegationDepth: currentDepth + 1,
        }));

        const result = await options.runAgent({
          definition,
          prompt: typedInput.prompt,
          parentConfig: options.parentConfig,
          isolation: typedInput.isolation,
        });

        return {
          data: {
            text: result.text,
            turns: result.turns,
            stopReason: result.stopReason,
          },
        };
      } catch (error) {
        return {
          data: `Agent delegation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        context.setState((prev) => ({
          ...prev,
          delegationDepth: currentDepth,
        }));
      }
    },

    mapToolResult(output, toolUseId) {
      const record =
        typeof output === 'object' && output !== null
          ? (output as Record<string, unknown>)
          : undefined;
      const content =
        typeof output === 'string'
          ? output
          : record !== undefined && typeof record.text === 'string'
            ? record.text
            : JSON.stringify(output);
      return { type: 'tool_result', tool_use_id: toolUseId, content };
    },
  });
}
