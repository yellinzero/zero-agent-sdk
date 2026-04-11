/**
 * MCP SDK-based transport adapters for SSE, HTTP (Streamable), and WebSocket.
 * Uses lazy import of @modelcontextprotocol/sdk — not a runtime dependency.
 */

import { AgentError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPSDKToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    idempotentHint?: boolean;
  };
}

export interface MCPSDKCallResult {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
}

interface MCPTransportConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface MCPStdioTransportConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPSSETransportConfig extends MCPTransportConfig {
  type: 'sse';
}

export interface MCPHTTPTransportConfig extends MCPTransportConfig {
  type: 'http';
}

export interface MCPWebSocketTransportConfig extends MCPTransportConfig {
  type: 'ws';
}

export type MCPSDKTransportConfig =
  | MCPStdioTransportConfig
  | MCPSSETransportConfig
  | MCPHTTPTransportConfig
  | MCPWebSocketTransportConfig;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Adapter that wraps @modelcontextprotocol/sdk Client for SSE/HTTP/WS transports.
 * The SDK is loaded lazily — if not installed, a clear error is thrown.
 */
export class MCPSDKClientAdapter {
  private config: MCPSDKTransportConfig;
  private client: unknown = null;
  private transport: unknown = null;
  private tools: MCPSDKToolInfo[] = [];
  private reconnectAttempts = 0;

  private static readonly MAX_RECONNECT_ATTEMPTS = 3;
  private static readonly BASE_DELAY_MS = 1000;
  private static readonly REQUEST_TIMEOUT_MS = 60_000;

  constructor(config: MCPSDKTransportConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Lazy import @modelcontextprotocol/sdk
    let sdkClient: any;
    let sdkTransport: any;

    try {
      sdkClient = await import('@modelcontextprotocol/sdk/client/index.js');
    } catch {
      throw new AgentError(
        `MCP transport requires @modelcontextprotocol/sdk. ` +
          `Install it with: npm install @modelcontextprotocol/sdk`,
        'MCP_ERROR'
      );
    }

    // Create the appropriate transport
    const { type } = this.config;

    if (type === 'stdio') {
      try {
        sdkTransport = await import('@modelcontextprotocol/sdk/client/stdio.js');
      } catch {
        throw new AgentError(
          `stdio transport requires @modelcontextprotocol/sdk. ` +
            `Install it with: npm install @modelcontextprotocol/sdk`,
          'MCP_ERROR'
        );
      }
      const stdioConfig = this.config as MCPStdioTransportConfig;
      this.transport = new sdkTransport.StdioClientTransport({
        command: stdioConfig.command,
        args: stdioConfig.args,
        env: { ...process.env, ...stdioConfig.env },
      });
    } else if (type === 'sse') {
      const { url, headers } = this.config as MCPSSETransportConfig;
      try {
        sdkTransport = await import('@modelcontextprotocol/sdk/client/sse.js');
      } catch {
        throw new AgentError(
          `SSE transport requires @modelcontextprotocol/sdk. ` +
            `Install it with: npm install @modelcontextprotocol/sdk`,
          'MCP_ERROR'
        );
      }
      this.transport = new sdkTransport.SSEClientTransport(new URL(url), {
        requestInit: headers ? { headers } : undefined,
      });
    } else if (type === 'http') {
      const { url, headers } = this.config as MCPHTTPTransportConfig;
      try {
        sdkTransport = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      } catch {
        throw new AgentError(
          `HTTP transport requires @modelcontextprotocol/sdk. ` +
            `Install it with: npm install @modelcontextprotocol/sdk`,
          'MCP_ERROR'
        );
      }
      this.transport = new sdkTransport.StreamableHTTPClientTransport(new URL(url), {
        requestInit: headers ? { headers } : undefined,
      });
    } else if (type === 'ws') {
      const { url } = this.config as MCPWebSocketTransportConfig;
      try {
        sdkTransport = await import('@modelcontextprotocol/sdk/client/websocket.js');
      } catch {
        throw new AgentError(
          `WebSocket transport requires @modelcontextprotocol/sdk. ` +
            `Install it with: npm install @modelcontextprotocol/sdk`,
          'MCP_ERROR'
        );
      }
      this.transport = new sdkTransport.WebSocketClientTransport(new URL(url));
    }

    // Create and connect the MCP client
    const { Client } = sdkClient;
    this.client = new Client({ name: 'zero-agent-sdk', version: '0.1.0' }, { capabilities: {} });

    await (this.client as any).connect(this.transport);

    // Discover tools
    const result = await (this.client as any).listTools();
    this.tools = (result.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
  }

  listTools(): MCPSDKToolInfo[] {
    return this.tools;
  }

  async callTool(name: string, args: unknown): Promise<MCPSDKCallResult> {
    if (!this.client) {
      throw new AgentError('MCP SDK client not connected', 'MCP_ERROR');
    }

    try {
      const result = await MCPSDKClientAdapter.withTimeout(
        (this.client as any).callTool({ name, arguments: args }),
        MCPSDKClientAdapter.REQUEST_TIMEOUT_MS
      );
      this.reconnectAttempts = 0;
      return result as MCPSDKCallResult;
    } catch (error) {
      if (MCPSDKClientAdapter.isSessionExpiredError(error)) {
        await this.reconnect();
        const result = await MCPSDKClientAdapter.withTimeout(
          (this.client as any).callTool({ name, arguments: args }),
          MCPSDKClientAdapter.REQUEST_TIMEOUT_MS
        );
        return result as MCPSDKCallResult;
      }
      throw error;
    }
  }

  private static withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP request timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  private static isSessionExpiredError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    // HTTP 404 (session not found) or JSON-RPC -32001 (session expired)
    return msg.includes('404') || msg.includes('-32001') || msg.includes('session expired');
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= MCPSDKClientAdapter.MAX_RECONNECT_ATTEMPTS) {
      throw new AgentError(
        `MCP reconnection failed after ${MCPSDKClientAdapter.MAX_RECONNECT_ATTEMPTS} attempts`,
        'MCP_ERROR'
      );
    }

    this.reconnectAttempts++;
    const delay = MCPSDKClientAdapter.BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Close existing connection
    try {
      await (this.client as any)?.close();
    } catch {
      // Ignore close errors during reconnect
    }

    this.client = null;
    this.transport = null;

    // Re-establish connection
    await this.connect();
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await (this.client as any).close();
      } catch {
        // Ignore close errors
      }
      this.client = null;
      this.transport = null;
    }
  }
}
