/**
 * MCP tool bridge — converts MCP tools to SDKTool interface.
 */

import { ToolExecutionError } from '../core/errors.js';
import type {
  SDKTool,
  SDKToolResult,
  ToolExecutionContext,
  ToolResultParam,
} from '../tools/types.js';
import { buildSDKTool } from '../tools/types.js';
import { encodeMCPToolName } from './normalization.js';
import { createPassthroughSchema } from './schema-utils.js';
import type { MCPInProcessServer, MCPToolDefinition, MCPToolResult } from './types.js';

/**
 * Convert MCP tool definitions to SDKTool instances.
 */
export function mcpToolsToSDKTools(server: MCPInProcessServer): SDKTool[] {
  return server.tools.map((toolDef) => mcpToolToSDKTool(server.name, toolDef));
}

function mcpToolToSDKTool(serverName: string, toolDef: MCPToolDefinition): SDKTool {
  const inputSchema =
    'parse' in toolDef.inputSchema
      ? (toolDef.inputSchema as any)
      : createPassthroughSchema(toolDef.inputSchema);

  return buildSDKTool({
    name: encodeMCPToolName(serverName, toolDef.name),
    inputSchema,
    inputJSONSchema: 'parse' in toolDef.inputSchema ? undefined : (toolDef.inputSchema as any),
    maxResultSizeChars: 100_000,

    async call(args, context): Promise<SDKToolResult> {
      const result = await toolDef.handler(args);

      // Check for error
      if (result.isError) {
        const errorText = result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        throw new ToolExecutionError(
          errorText || 'MCP tool returned an error',
          encodeMCPToolName(serverName, toolDef.name)
        );
      }

      // Check if there are non-text content blocks (e.g. images)
      const hasNonText = result.content.some((c) => c.type !== 'text');
      if (hasNonText) {
        const blocks = result.content.map((c) => {
          if (c.type === 'text') {
            return { type: 'text' as const, text: c.text };
          }
          if (c.type === 'image') {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: c.mimeType,
                data: c.data,
              },
            };
          }
          return { type: 'text' as const, text: JSON.stringify(c) };
        });
        return { data: blocks };
      }

      const text = result.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      return { data: text };
    },

    async description() {
      return toolDef.description;
    },

    async prompt() {
      return toolDef.description;
    },

    isConcurrencySafe: () => {
      // readOnly + non-destructive = safe to run concurrently
      return (
        (toolDef.annotations?.readOnlyHint ?? false) &&
        !(toolDef.annotations?.destructiveHint ?? false)
      );
    },
    isReadOnly: () => toolDef.annotations?.readOnlyHint ?? false,
    isDestructive: () => toolDef.annotations?.destructiveHint ?? false,
  });
}
