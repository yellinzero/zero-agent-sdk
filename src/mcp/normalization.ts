/**
 * MCP name normalization — handle tool name encoding/decoding.
 * MCP tools are namespaced as: mcp__serverName__toolName
 * Server and tool names must match: ^[a-zA-Z0-9_-]{1,64}$
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_PREFIX = 'mcp__';
const NAME_SEPARATOR = '__';
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a server name to be API-compatible.
 * Replaces invalid characters with underscores.
 */
export function normalizeServerName(name: string): string {
  let normalized = name
    .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid chars
    .replace(/_{2,}/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, ''); // Trim leading/trailing underscores

  if (!normalized) normalized = 'server';

  // Truncate to 64 chars
  if (normalized.length > 64) {
    normalized = normalized.slice(0, 64);
  }

  return normalized;
}

/**
 * Normalize a tool name to be API-compatible.
 */
export function normalizeToolName(name: string): string {
  let normalized = name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');

  if (!normalized) normalized = 'tool';

  if (normalized.length > 64) {
    normalized = normalized.slice(0, 64);
  }

  return normalized;
}

/**
 * Validate that a name matches the API format.
 */
export function isValidMCPName(name: string): boolean {
  return VALID_NAME_REGEX.test(name);
}

// ---------------------------------------------------------------------------
// Encoding / Decoding
// ---------------------------------------------------------------------------

/**
 * Encode a namespaced MCP tool name: mcp__serverName__toolName
 */
export function encodeMCPToolName(serverName: string, toolName: string): string {
  return `${MCP_PREFIX}${normalizeServerName(serverName)}${NAME_SEPARATOR}${normalizeToolName(toolName)}`;
}

/**
 * Decode a namespaced MCP tool name back to server + tool parts.
 * Returns null if the name is not a valid MCP tool name.
 */
export function decodeMCPToolName(
  fullName: string
): { serverName: string; toolName: string } | null {
  if (!fullName.startsWith(MCP_PREFIX)) return null;

  const rest = fullName.slice(MCP_PREFIX.length);
  const separatorIndex = rest.indexOf(NAME_SEPARATOR);
  if (separatorIndex === -1) return null;

  const serverName = rest.slice(0, separatorIndex);
  const toolName = rest.slice(separatorIndex + NAME_SEPARATOR.length);

  if (!serverName || !toolName) return null;

  return { serverName, toolName };
}

/**
 * Check if a tool name is an MCP-namespaced tool.
 */
export function isMCPTool(name: string): boolean {
  return name.startsWith(MCP_PREFIX);
}
