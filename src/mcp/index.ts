/**
 * MCP sub-package entry point.
 */

export { MCPClient } from './client.js';
export {
  decodeMCPToolName,
  encodeMCPToolName,
  isMCPTool,
  isValidMCPName,
  normalizeServerName,
  normalizeToolName,
} from './normalization.js';
export { mcpToolsToSDKTools } from './tool-bridge.js';
export type {
  MCPConnection,
  MCPConnectionEvent,
  MCPConnectionStatus,
  MCPElicitationHandler,
  MCPElicitationRequest,
  MCPElicitationResponse,
  MCPHTTPConfig,
  MCPInProcessConfig,
  MCPInProcessServer,
  MCPServerConfig,
  MCPSSEConfig,
  MCPStdioConfig,
  MCPToolAnnotations,
  MCPToolDefinition,
  MCPToolResult,
  MCPWebSocketConfig,
} from './types.js';
