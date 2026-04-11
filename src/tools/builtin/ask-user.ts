/**
 * AskUser tool — allows the agent to ask the user questions during execution.
 * The tool returns the input data directly; the host application handles the actual interaction
 * via the permission system (checkPermissions returns 'ask').
 */

import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  label: z.string().describe('The display text for this option'),
  description: z.string().describe('Explanation of what this option means'),
  preview: z.string().optional().describe('Optional preview content'),
});

const questionSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  header: z.string().optional().describe('Short label displayed as a chip/tag (max 12 chars)'),
  options: z.array(optionSchema).min(2).max(4).optional().describe('The available choices'),
  multiSelect: z.boolean().optional().describe('Allow multiple selections'),
});

const inputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(4).describe('Questions to ask the user'),
  answers: z.record(z.string(), z.string()).optional().describe('User answers'),
  annotations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional()
    .describe('Per-question annotations'),
  metadata: z
    .object({
      source: z.string().optional(),
    })
    .optional()
    .describe('Optional metadata for tracking'),
});

type AskUserInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createAskUserTool(): SDKTool<AskUserInput, AskUserInput> {
  return buildSDKTool({
    name: 'AskUserQuestion',
    aliases: ['AskUser'],
    inputSchema,
    maxResultSizeChars: 10_000,

    async description() {
      return 'Ask the user questions during execution to gather preferences, clarify instructions, or get decisions on implementation choices.';
    },

    async prompt() {
      return [
        'Use AskUserQuestion when you need to:',
        '- Gather user preferences or requirements',
        '- Clarify ambiguous instructions',
        '- Get decisions on implementation choices',
        '- Offer choices about direction to take',
      ].join('\n');
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    async checkPermissions(input) {
      // Format the questions as a readable message for the permission system.
      // The host resolves the permission_request event with { allow: true, updatedInput: { ...input, answers } }.
      const questionsText = input.questions?.map((q) => q.question).join('; ') ?? 'question';
      return { behavior: 'ask' as const, message: `Agent asks: ${questionsText}` };
    },

    async call(input) {
      // If the host provided answers via updatedInput in the permission response,
      // they will already be merged into the input by the orchestration layer.
      // Return the input (which now includes answers if the host provided them).
      return { data: input };
    },

    mapToolResult(output, toolUseId) {
      const text = output.answers
        ? Object.entries(output.answers)
            .map(([q, a]) => `Q: ${q}\nA: ${a}`)
            .join('\n\n')
        : JSON.stringify(output.questions.map((q) => q.question));
      return { type: 'tool_result', tool_use_id: toolUseId, content: text };
    },
  });
}
