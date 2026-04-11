/**
 * MCP (Model Context Protocol) types for the SDK.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// MCP Server Configuration
// ---------------------------------------------------------------------------

export type MCPServerConfig =
  | MCPStdioConfig
  | MCPSSEConfig
  | MCPHTTPConfig
  | MCPWebSocketConfig
  | MCPInProcessConfig;

export interface MCPStdioConfig {
  type: 'stdio';
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPSSEConfig {
  type: 'sse';
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface MCPHTTPConfig {
  type: 'http';
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface MCPWebSocketConfig {
  type: 'ws';
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface MCPInProcessConfig {
  type: 'in-process';
  name: string;
  server: MCPInProcessServer;
}

// ---------------------------------------------------------------------------
// In-Process MCP Server
// ---------------------------------------------------------------------------

export interface MCPInProcessServer {
  name: string;
  tools: MCPToolDefinition[];
}

/**
 * MCP tool annotations as defined by the MCP specification (2024-11-05+).
 * All fields are hints — servers may set them, but clients should treat
 * missing values conservatively (assume not read-only, not destructive, etc.).
 */
export interface MCPToolAnnotations {
  /** If true the tool does not modify any state (safe to run concurrently). */
  readOnlyHint?: boolean;
  /** If true the tool performs irreversible operations. */
  destructiveHint?: boolean;
  /** If true the tool may interact with external entities. */
  openWorldHint?: boolean;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType | Record<string, unknown>;
  handler: (input: unknown) => Promise<MCPToolResult>;
  /** MCP tool annotations (readOnlyHint, destructiveHint, openWorldHint). */
  annotations?: MCPToolAnnotations;
}

export interface MCPToolResult {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// MCP Connection State
// ---------------------------------------------------------------------------

export type MCPConnectionStatus = 'connected' | 'connecting' | 'failed' | 'disconnected';

export interface MCPConnection {
  name: string;
  status: MCPConnectionStatus;
  config: MCPServerConfig;
  tools: string[];
  error?: Error;
}

// ---------------------------------------------------------------------------
// MCP Connection State Events
// ---------------------------------------------------------------------------

export type MCPConnectionEvent =
  | { type: 'connecting'; serverName: string }
  | { type: 'connected'; serverName: string; toolCount: number }
  | { type: 'reconnecting'; serverName: string; attempt: number }
  | { type: 'disconnected'; serverName: string }
  | { type: 'failed'; serverName: string; error: Error }
  | { type: 'tools_changed'; serverName: string; tools: string[] };

// ---------------------------------------------------------------------------
// MCP Elicitation (OAuth/Auth flow)
// ---------------------------------------------------------------------------

export interface MCPElicitationRequest {
  serverId: string;
  message: string;
  schema?: Record<string, unknown>;
}

export interface MCPElicitationResponse {
  accepted: boolean;
  data?: Record<string, unknown>;
}

export type MCPElicitationHandler = (
  request: MCPElicitationRequest,
  signal?: AbortSignal
) => Promise<MCPElicitationResponse>;
