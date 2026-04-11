import { describe, expect, it } from 'vitest';
import {
  decodeMCPToolName,
  encodeMCPToolName,
  isMCPTool,
  isValidMCPName,
  normalizeServerName,
  normalizeToolName,
} from '../mcp/normalization.js';

describe('normalizeServerName', () => {
  it('should pass through valid names', () => {
    expect(normalizeServerName('my-server')).toBe('my-server');
    expect(normalizeServerName('server_v2')).toBe('server_v2');
  });

  it('should replace invalid characters', () => {
    expect(normalizeServerName('my server!')).toBe('my_server');
    expect(normalizeServerName('hello@world')).toBe('hello_world');
  });

  it('should collapse multiple underscores', () => {
    expect(normalizeServerName('a___b')).toBe('a_b');
  });

  it('should truncate to 64 chars', () => {
    const long = 'a'.repeat(100);
    expect(normalizeServerName(long).length).toBe(64);
  });

  it('should default to "server" for empty input', () => {
    expect(normalizeServerName('!!!')).toBe('server');
  });
});

describe('normalizeToolName', () => {
  it('should pass through valid names', () => {
    expect(normalizeToolName('read_file')).toBe('read_file');
  });

  it('should default to "tool" for empty input', () => {
    expect(normalizeToolName('...')).toBe('tool');
  });
});

describe('isValidMCPName', () => {
  it('should accept valid names', () => {
    expect(isValidMCPName('my-tool')).toBe(true);
    expect(isValidMCPName('Tool_v2')).toBe(true);
    expect(isValidMCPName('a')).toBe(true);
  });

  it('should reject invalid names', () => {
    expect(isValidMCPName('')).toBe(false);
    expect(isValidMCPName('has space')).toBe(false);
    expect(isValidMCPName('a'.repeat(65))).toBe(false);
  });
});

describe('encodeMCPToolName', () => {
  it('should encode server and tool names', () => {
    expect(encodeMCPToolName('myserver', 'read')).toBe('mcp__myserver__read');
  });

  it('should normalize names during encoding', () => {
    expect(encodeMCPToolName('my server', 'read file')).toBe('mcp__my_server__read_file');
  });
});

describe('decodeMCPToolName', () => {
  it('should decode valid MCP tool names', () => {
    const result = decodeMCPToolName('mcp__myserver__read');
    expect(result).toEqual({ serverName: 'myserver', toolName: 'read' });
  });

  it('should return null for non-MCP names', () => {
    expect(decodeMCPToolName('Bash')).toBeNull();
    expect(decodeMCPToolName('mcp__')).toBeNull();
  });

  it('should handle names with underscores', () => {
    const result = decodeMCPToolName('mcp__my_server__read_file');
    expect(result).toEqual({ serverName: 'my_server', toolName: 'read_file' });
  });
});

describe('isMCPTool', () => {
  it('should identify MCP tools', () => {
    expect(isMCPTool('mcp__server__tool')).toBe(true);
    expect(isMCPTool('mcp__x__y')).toBe(true);
  });

  it('should not identify non-MCP tools', () => {
    expect(isMCPTool('Bash')).toBe(false);
    expect(isMCPTool('Read')).toBe(false);
  });
});
