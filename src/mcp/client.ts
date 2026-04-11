/**
 * MCP Client — manages connections to MCP servers and discovers tools.
 * All transport types (stdio, SSE, HTTP, WS) use @modelcontextprotocol/sdk via MCPSDKClientAdapter.
 *
 * Usage:
 * ```ts
 * const client = new MCPClient();
 * await client.connect({ type: 'stdio', name: 'my-server', command: 'node', args: ['server.js'] });
 * const tools = client.getTools(); // SDKTool[]
 * await client.close();
 * ```
 */

import { randomUUID } from 'node:crypto';
import { AgentError } from '../core/errors.js';
import type { SDKTool } from '../tools/types.js';
import { buildSDKTool } from '../tools/types.js';
import { encodeMCPToolName, normalizeServerName, normalizeToolName } from './normalization.js';
import { createPassthroughSchema } from './schema-utils.js';
import { mcpToolsToSDKTools } from './tool-bridge.js';
import { MCPSDKClientAdapter, type MCPSDKTransportConfig } from './transports.js';
import type {
  MCPConnection,
  MCPConnectionStatus,
  MCPInProcessConfig,
  MCPServerConfig,
  MCPStdioConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

interface MCPCallToolResult {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// MCP Client
// ---------------------------------------------------------------------------

export class MCPClient {
  private connections = new Map<
    string,
    {
      config: MCPServerConfig;
      sdkAdapter: MCPSDKClientAdapter | null;
      status: MCPConnectionStatus;
      tools: SDKTool[];
      toolInfos: MCPToolInfo[];
      error?: Error;
    }
  >();

  private onConnectionEvent?: (event: import('./types.js').MCPConnectionEvent) => void;

  constructor(options?: {
    onConnectionEvent?: (event: import('./types.js').MCPConnectionEvent) => void;
  }) {
    this.onConnectionEvent = options?.onConnectionEvent;
  }

  /**
   * Connect to an MCP server and discover its tools.
   */
  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    const name = normalizeServerName(config.name);

    // Handle in-process servers (already supported via tool-bridge)
    if (config.type === 'in-process') {
      const tools = mcpToolsToSDKTools(config.server);
      const conn = {
        config,
        sdkAdapter: null,
        status: 'connected' as MCPConnectionStatus,
        tools,
        toolInfos: config.server.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      };
      this.connections.set(name, conn);
      return this.toMCPConnection(name, conn);
    }

    // All external transports (stdio, SSE, HTTP, WS) use the SDK adapter
    let adapterConfig: MCPSDKTransportConfig;
    if (config.type === 'stdio') {
      adapterConfig = {
        type: 'stdio',
        command: config.command,
        args: config.args,
        env: config.env,
      };
    } else if (config.type === 'sse' || config.type === 'http' || config.type === 'ws') {
      adapterConfig = {
        type: config.type,
        url: config.url,
        headers: config.headers,
      } as MCPSDKTransportConfig;
    } else {
      throw new AgentError(
        `Unsupported transport type: '${(config as any).type}'. ` +
          `Supported types: 'stdio', 'in-process', 'sse', 'http', 'ws'.`,
        'MCP_ERROR'
      );
    }

    const adapter = new MCPSDKClientAdapter(adapterConfig);

    const entry = {
      config,
      sdkAdapter: adapter,
      status: 'connecting' as MCPConnectionStatus,
      tools: [] as SDKTool[],
      toolInfos: [] as MCPToolInfo[],
      error: undefined as Error | undefined,
    };
    this.connections.set(name, entry);
    this.onConnectionEvent?.({ type: 'connecting', serverName: name });

    try {
      await adapter.connect();
      entry.toolInfos = adapter.listTools();
      entry.tools = entry.toolInfos.map((info) => {
        // Merge annotations from adapter into MCPToolInfo
        const toolInfo: MCPToolInfo = {
          name: info.name,
          description: info.description,
          inputSchema: info.inputSchema,
          annotations: info.annotations,
        };
        return this.createSDKToolFromSDKAdapter(name, toolInfo, adapter);
      });
      entry.status = 'connected';
      this.onConnectionEvent?.({
        type: 'connected',
        serverName: name,
        toolCount: entry.tools.length,
      });
    } catch (err) {
      entry.status = 'failed';
      entry.error = err instanceof Error ? err : new Error(String(err));
      this.onConnectionEvent?.({ type: 'failed', serverName: name, error: entry.error! });
      await adapter.close();
      // Re-throw so callers (e.g. AgentImpl retry logic) can detect the failure
      throw entry.error;
    }

    return this.toMCPConnection(name, entry);
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnect(serverName: string): Promise<void> {
    const name = normalizeServerName(serverName);
    const conn = this.connections.get(name);
    if (conn) {
      await conn.sdkAdapter?.close();
      conn.status = 'disconnected';
      this.onConnectionEvent?.({ type: 'disconnected', serverName: name });
      this.connections.delete(name);
    }
  }

  /**
   * Disconnect from all servers.
   */
  async close(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map((name) => this.disconnect(name));
    await Promise.allSettled(promises);
  }

  /**
   * Get all discovered tools from all connected servers.
   */
  getTools(): SDKTool[] {
    const tools: SDKTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }

  /**
   * Get connection status for all servers.
   */
  getConnections(): MCPConnection[] {
    return Array.from(this.connections.entries()).map(([name, conn]) =>
      this.toMCPConnection(name, conn)
    );
  }

  /**
   * Refresh tool list from a connected server.
   */
  async refreshTools(serverName: string): Promise<SDKTool[]> {
    const name = normalizeServerName(serverName);
    const conn = this.connections.get(name);
    if (!conn || conn.status !== 'connected' || !conn.sdkAdapter) {
      throw new AgentError(`Server '${serverName}' is not connected`, 'MCP_ERROR');
    }

    // Re-list tools from the adapter
    conn.toolInfos = conn.sdkAdapter.listTools();
    conn.tools = conn.toolInfos.map((info) => {
      const toolInfo: MCPToolInfo = {
        name: info.name,
        description: info.description,
        inputSchema: info.inputSchema,
        annotations: info.annotations,
      };
      return this.createSDKToolFromSDKAdapter(name, toolInfo, conn.sdkAdapter!);
    });

    this.onConnectionEvent?.({
      type: 'tools_changed',
      serverName: name,
      tools: conn.toolInfos.map((t) => t.name),
    });

    return conn.tools;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private createSDKToolFromSDKAdapter(
    serverName: string,
    info: MCPToolInfo,
    adapter: MCPSDKClientAdapter
  ): SDKTool {
    const fullName = encodeMCPToolName(serverName, info.name);
    const inputSchema = info.inputSchema
      ? createPassthroughSchema(info.inputSchema)
      : createPassthroughSchema({ type: 'object' });

    return buildSDKTool({
      name: fullName,
      inputSchema,
      inputJSONSchema: info.inputSchema as any,
      maxResultSizeChars: 100_000,

      async call(args): Promise<{ data: unknown }> {
        const result = await adapter.callTool(info.name, args);

        // Check for error
        if (result.isError) {
          const errorText = result.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          throw new AgentError(errorText || 'MCP tool returned an error', 'MCP_ERROR');
        }

        // Check if there are non-text content blocks (e.g. images)
        const hasNonText = result.content.some((c) => c.type !== 'text');
        if (hasNonText) {
          // Return mixed content as an array of content blocks
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

        // All text — return concatenated string
        const text = result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        return { data: text };
      },

      async description() {
        return info.description ?? `MCP tool: ${info.name}`;
      },

      async prompt() {
        return info.description ?? `MCP tool: ${info.name}`;
      },

      isConcurrencySafe: () => info.annotations?.readOnlyHint ?? false,
      isReadOnly: () => info.annotations?.readOnlyHint ?? false,
      isDestructive: () => info.annotations?.destructiveHint ?? false,
    });
  }

  private toMCPConnection(
    name: string,
    conn: {
      config: MCPServerConfig;
      status: MCPConnectionStatus;
      toolInfos: MCPToolInfo[];
      error?: Error;
    }
  ): MCPConnection {
    return {
      name,
      status: conn.status,
      config: conn.config,
      tools: conn.toolInfos.map((t) => t.name),
      error: conn.error,
    };
  }
}
