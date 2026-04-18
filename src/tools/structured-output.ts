/**
 * Synthetic structured-output tool — used by providers that lack native
 * `responseFormat` support (e.g. Anthropic, Bedrock Converse). The agent loop
 * injects this tool into the model's tool list and treats a successful call
 * as the final structured answer.
 *
 * Validation is delegated to the supplied `OutputDefinition` so the same
 * Zod schema that the user declared via `Output.object/array/enum` enforces
 * the tool input. Validation errors are returned as tool-error results so the
 * agent loop can repair (re-ask the model) up to a configured budget.
 */

import { z } from 'zod';
import { formatZodError, type OutputDefinition } from '../core/output.js';
import type {
  PermissionCheckResult,
  SDKTool,
  SDKToolResult,
  ToolExecutionContext,
  ToolInputJSONSchema,
  ToolResultParam,
} from './types.js';

export const SYNTHETIC_OUTPUT_TOOL_NAME = '__zero_sdk_structured_output__';
export const STRUCTURED_OUTPUT_ERROR_MARKER = 'zeroAgentStructuredOutput';

export interface StructuredOutputErrorMarker {
  schemaValidationFailure: boolean;
}

interface ToolShape {
  inputJSONSchema: ToolInputJSONSchema;
  /** Map raw tool input to the value handed back as the structured output. */
  unwrap(input: Record<string, unknown>): unknown;
}

function deriveToolShape(output: OutputDefinition<unknown, unknown, unknown>): ToolShape {
  const responseFormat = output.responseFormat;

  if (responseFormat.type === 'json_object') {
    // Free-form JSON — no schema constraints. Accept any object.
    return {
      inputJSONSchema: { type: 'object', additionalProperties: true },
      unwrap: (input) => input,
    };
  }

  if (responseFormat.type === 'json_schema') {
    const schema = responseFormat.schema;
    const isObjectSchema =
      schema.type === 'object' ||
      (schema.type === undefined &&
        (schema.properties !== undefined ||
          schema.required !== undefined ||
          schema.additionalProperties !== undefined));

    if (isObjectSchema) {
      // The schema already describes the top-level object the model should
      // emit; use it verbatim as the tool input schema.
      return {
        inputJSONSchema: { type: 'object', ...schema },
        unwrap: (input) => input,
      };
    }

    // Wrap non-object schemas under a `result` property so the tool input is
    // always an object (most providers require object-typed tool inputs).
    return {
      inputJSONSchema: {
        type: 'object',
        properties: { result: schema },
        required: ['result'],
        additionalProperties: false,
      },
      unwrap: (input) => input.result,
    };
  }

  // text — should not happen because the agent loop never injects this tool
  // for text outputs, but guard anyway.
  return {
    inputJSONSchema: { type: 'object', additionalProperties: true },
    unwrap: (input) => input,
  };
}

export function isSyntheticStructuredOutputTool(name: string): boolean {
  return name === SYNTHETIC_OUTPUT_TOOL_NAME;
}

/**
 * Build the synthetic structured-output tool for a given `OutputDefinition`.
 * Returns `null` when no tool injection is needed (e.g. plain text output).
 */
export function createStructuredOutputTool(
  output: OutputDefinition<unknown, unknown, unknown> | undefined
): SDKTool<Record<string, unknown>, unknown> | null {
  if (!output || output.kind === 'text') return null;

  const shape = deriveToolShape(output);

  return {
    name: SYNTHETIC_OUTPUT_TOOL_NAME,
    inputSchema: z.object({}).passthrough(),
    inputJSONSchema: shape.inputJSONSchema,
    maxResultSizeChars: 100_000,
    async call(
      args: Record<string, unknown>,
      _context: ToolExecutionContext
    ): Promise<SDKToolResult<unknown>> {
      const value = shape.unwrap(args);
      try {
        const validated = output.validate(value);
        return { data: validated };
      } catch (error) {
        const message =
          error instanceof z.ZodError
            ? `Schema validation failed:\n${formatZodError(error)}`
            : error instanceof Error
              ? error.message
              : String(error);
        // Throwing here surfaces as is_error=true on the tool result. The
        // agent loop counts these as repair attempts and decides whether to
        // ask the model to try again or bail out.
        const structuredError = new Error(message) as Error & {
          [STRUCTURED_OUTPUT_ERROR_MARKER]?: StructuredOutputErrorMarker;
        };
        structuredError[STRUCTURED_OUTPUT_ERROR_MARKER] = { schemaValidationFailure: true };
        throw structuredError;
      }
    },
    async description() {
      return 'Return the final structured response in the requested format.';
    },
    async prompt() {
      return (
        'Use this tool only for the final answer after all other required tools are complete. ' +
        'Call it exactly once with the final structured result.'
      );
    },
    async checkPermissions(): Promise<PermissionCheckResult> {
      return { behavior: 'allow' };
    },
    isConcurrencySafe() {
      return true;
    },
    isReadOnly() {
      return true;
    },
    isEnabled() {
      return true;
    },
    mapToolResult(_content: unknown, toolUseId: string): ToolResultParam {
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: 'Structured output recorded.',
      };
    },
  };
}
