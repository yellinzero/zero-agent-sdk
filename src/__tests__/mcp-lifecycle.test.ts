import { describe, expect, it } from 'vitest';
import { MCPClient } from '../mcp/client.js';
import type {
  MCPConnectionEvent,
  MCPInProcessConfig,
  MCPInProcessServer,
  MCPToolDefinition,
  MCPToolResult,
} from '../mcp/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolDef(
  name: string,
  description: string,
  annotations?: MCPToolDefinition['annotations'],
  handler?: MCPToolDefinition['handler']
): MCPToolDefinition {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    handler: handler ?? (async () => ({ content: [{ type: 'text', text: `${name} result` }] })),
    annotations,
  };
}

function makeInProcessServer(name: string, tools: MCPToolDefinition[]): MCPInProcessServer {
  return { name, tools };
}

function makeInProcessConfig(server: MCPInProcessServer): MCPInProcessConfig {
  return { type: 'in-process', name: server.name, server };
}

// ---------------------------------------------------------------------------
// MCP Connection Events
// ---------------------------------------------------------------------------

describe('MCP Connection Events', () => {
  it('constructor accepts onConnectionEvent callback', () => {
    const events: MCPConnectionEvent[] = [];
    const client = new MCPClient({
      onConnectionEvent: (event) => events.push(event),
    });
    // Client created successfully with the callback — no error thrown.
    expect(client).toBeDefined();
  });

  it('connect with in-process server stores connection correctly', async () => {
    const events: MCPConnectionEvent[] = [];
    const client = new MCPClient({
      onConnectionEvent: (event) => events.push(event),
    });

    const server = makeInProcessServer('test-server', [makeToolDef('greet', 'Says hello')]);

    const conn = await client.connect(makeInProcessConfig(server));

    expect(conn.name).toBe('test-server');
    expect(conn.status).toBe('connected');
    expect(conn.tools).toContain('greet');

    // In-process connections do not emit connecting/connected events
    // because they bypass the SDK adapter path.
    const connections = client.getConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0].status).toBe('connected');

    await client.close();
  });

  it('disconnect removes connection from map', async () => {
    const events: MCPConnectionEvent[] = [];
    const client = new MCPClient({
      onConnectionEvent: (event) => events.push(event),
    });

    const server = makeInProcessServer('removable', [makeToolDef('ping', 'Ping tool')]);

    await client.connect(makeInProcessConfig(server));
    expect(client.getConnections()).toHaveLength(1);

    await client.disconnect('removable');
    expect(client.getConnections()).toHaveLength(0);

    // Should have emitted a disconnected event
    const disconnectedEvents = events.filter((e) => e.type === 'disconnected');
    expect(disconnectedEvents).toHaveLength(1);
    expect(disconnectedEvents[0].serverName).toBe('removable');
  });

  it('close() disconnects all servers', async () => {
    const events: MCPConnectionEvent[] = [];
    const client = new MCPClient({
      onConnectionEvent: (event) => events.push(event),
    });

    const serverA = makeInProcessServer('server-a', [makeToolDef('toolA', 'Tool A')]);
    const serverB = makeInProcessServer('server-b', [makeToolDef('toolB', 'Tool B')]);

    await client.connect(makeInProcessConfig(serverA));
    await client.connect(makeInProcessConfig(serverB));
    expect(client.getConnections()).toHaveLength(2);

    await client.close();
    expect(client.getConnections()).toHaveLength(0);

    const disconnectedEvents = events.filter((e) => e.type === 'disconnected');
    expect(disconnectedEvents).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// MCP Tool Annotations Passthrough
// ---------------------------------------------------------------------------

describe('MCP Tool Annotations Passthrough', () => {
  it('getTools() returns SDKTools where isReadOnly matches readOnlyHint', async () => {
    const client = new MCPClient();

    const server = makeInProcessServer('annotated', [
      makeToolDef('reader', 'Read-only tool', { readOnlyHint: true }),
      makeToolDef('writer', 'Writable tool', { readOnlyHint: false }),
      makeToolDef('default-tool', 'No annotations'),
    ]);

    await client.connect(makeInProcessConfig(server));
    const tools = client.getTools();
    expect(tools).toHaveLength(3);

    const reader = tools.find((t) => t.name.includes('reader'))!;
    const writer = tools.find((t) => t.name.includes('writer'))!;
    const defaultTool = tools.find((t) => t.name.includes('default-tool'))!;

    expect(reader.isReadOnly({} as any)).toBe(true);
    expect(writer.isReadOnly({} as any)).toBe(false);
    // Missing annotation defaults to false
    expect(defaultTool.isReadOnly({} as any)).toBe(false);

    await client.close();
  });

  it('getTools() returns SDKTools where isDestructive matches destructiveHint', async () => {
    const client = new MCPClient();

    const server = makeInProcessServer('destructive-server', [
      makeToolDef('deleter', 'Destructive tool', { destructiveHint: true }),
      makeToolDef('safe', 'Safe tool', { destructiveHint: false }),
      makeToolDef('unknown', 'Unknown tool'),
    ]);

    await client.connect(makeInProcessConfig(server));
    const tools = client.getTools();

    const deleter = tools.find((t) => t.name.includes('deleter'))!;
    const safe = tools.find((t) => t.name.includes('safe'))!;
    const unknown = tools.find((t) => t.name.includes('unknown'))!;

    expect(deleter.isDestructive?.({} as any)).toBe(true);
    expect(safe.isDestructive?.({} as any)).toBe(false);
    // Missing annotation defaults to false
    expect(unknown.isDestructive?.({} as any)).toBe(false);

    await client.close();
  });

  it('isConcurrencySafe matches readOnlyHint', async () => {
    const client = new MCPClient();

    const server = makeInProcessServer('concurrent-server', [
      makeToolDef('readonly-tool', 'Read-only concurrent', { readOnlyHint: true }),
      makeToolDef('mutable-tool', 'Mutable tool', { readOnlyHint: false }),
      makeToolDef('bare-tool', 'No annotations'),
    ]);

    await client.connect(makeInProcessConfig(server));
    const tools = client.getTools();

    const readonlyTool = tools.find((t) => t.name.includes('readonly-tool'))!;
    const mutableTool = tools.find((t) => t.name.includes('mutable-tool'))!;
    const bareTool = tools.find((t) => t.name.includes('bare-tool'))!;

    expect(readonlyTool.isConcurrencySafe({} as any)).toBe(true);
    expect(mutableTool.isConcurrencySafe({} as any)).toBe(false);
    expect(bareTool.isConcurrencySafe({} as any)).toBe(false);

    await client.close();
  });

  it('combined annotations work together', async () => {
    const client = new MCPClient();

    const server = makeInProcessServer('combo', [
      makeToolDef('safe-reader', 'Safe read-only', {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      }),
      makeToolDef('dangerous-writer', 'Dangerous writer', {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      }),
    ]);

    await client.connect(makeInProcessConfig(server));
    const tools = client.getTools();

    const safeReader = tools.find((t) => t.name.includes('safe-reader'))!;
    const dangerousWriter = tools.find((t) => t.name.includes('dangerous-writer'))!;

    expect(safeReader.isReadOnly({} as any)).toBe(true);
    expect(safeReader.isDestructive?.({} as any)).toBe(false);
    expect(safeReader.isConcurrencySafe({} as any)).toBe(true);

    expect(dangerousWriter.isReadOnly({} as any)).toBe(false);
    expect(dangerousWriter.isDestructive?.({} as any)).toBe(true);
    expect(dangerousWriter.isConcurrencySafe({} as any)).toBe(false);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// MCPConnectionEvent type checking
// ---------------------------------------------------------------------------

describe('MCPConnectionEvent type checking', () => {
  it('event type union covers connecting, connected, failed, disconnected, tools_changed', () => {
    // This is a compile-time check — we construct each variant and verify
    // the discriminated union resolves correctly at runtime.
    const events: MCPConnectionEvent[] = [
      { type: 'connecting', serverName: 'a' },
      { type: 'connected', serverName: 'b', toolCount: 3 },
      { type: 'failed', serverName: 'c', error: new Error('oops') },
      { type: 'disconnected', serverName: 'd' },
      { type: 'tools_changed', serverName: 'e', tools: ['t1', 't2'] },
      { type: 'reconnecting', serverName: 'f', attempt: 1 },
    ];

    const types = events.map((e) => e.type);
    expect(types).toContain('connecting');
    expect(types).toContain('connected');
    expect(types).toContain('failed');
    expect(types).toContain('disconnected');
    expect(types).toContain('tools_changed');
    expect(types).toContain('reconnecting');
  });

  it('each event variant has the correct shape', () => {
    const connecting: MCPConnectionEvent = { type: 'connecting', serverName: 'srv' };
    expect(connecting.type).toBe('connecting');
    expect(connecting.serverName).toBe('srv');

    const connected: MCPConnectionEvent = { type: 'connected', serverName: 'srv', toolCount: 5 };
    expect(connected.type).toBe('connected');
    if (connected.type === 'connected') {
      expect(connected.toolCount).toBe(5);
    }

    const failed: MCPConnectionEvent = {
      type: 'failed',
      serverName: 'srv',
      error: new Error('fail'),
    };
    expect(failed.type).toBe('failed');
    if (failed.type === 'failed') {
      expect(failed.error.message).toBe('fail');
    }

    const disconnected: MCPConnectionEvent = { type: 'disconnected', serverName: 'srv' };
    expect(disconnected.type).toBe('disconnected');

    const toolsChanged: MCPConnectionEvent = {
      type: 'tools_changed',
      serverName: 'srv',
      tools: ['a', 'b'],
    };
    if (toolsChanged.type === 'tools_changed') {
      expect(toolsChanged.tools).toEqual(['a', 'b']);
    }
  });
});

// ---------------------------------------------------------------------------
// In-process server test
// ---------------------------------------------------------------------------

describe('In-process server', () => {
  it('create a mock MCPInProcessServer, connect, and discover tools', async () => {
    const server = makeInProcessServer('math-server', [
      makeToolDef('add', 'Add two numbers', undefined, async (input: any) => ({
        content: [{ type: 'text' as const, text: String(input.a + input.b) }],
      })),
      makeToolDef('multiply', 'Multiply two numbers', undefined, async (input: any) => ({
        content: [{ type: 'text' as const, text: String(input.a * input.b) }],
      })),
    ]);

    const client = new MCPClient();
    const conn = await client.connect(makeInProcessConfig(server));

    expect(conn.status).toBe('connected');
    expect(conn.tools).toHaveLength(2);
    expect(conn.tools).toContain('add');
    expect(conn.tools).toContain('multiply');

    // Verify tools are available via getTools()
    const sdkTools = client.getTools();
    expect(sdkTools).toHaveLength(2);
    expect(sdkTools.map((t) => t.name)).toEqual(
      expect.arrayContaining([expect.stringContaining('add'), expect.stringContaining('multiply')])
    );

    await client.close();
  });

  it('tools are callable and return correct results', async () => {
    const server = makeInProcessServer('echo-server', [
      makeToolDef('echo', 'Echo input', undefined, async (input: any) => ({
        content: [{ type: 'text' as const, text: `echo: ${JSON.stringify(input)}` }],
      })),
    ]);

    const client = new MCPClient();
    await client.connect(makeInProcessConfig(server));

    const tools = client.getTools();
    const echoTool = tools.find((t) => t.name.includes('echo'))!;
    expect(echoTool).toBeDefined();

    // Call the tool
    const result = await echoTool.call({ message: 'hello' } as any, {
      cwd: '/tmp',
      abortSignal: new AbortController().signal,
      tools: [],
      messages: [],
      model: 'test',
      debug: false,
      readFileState: new Map(),
      getState: () => ({}),
      setState: () => {},
    });

    expect(result.data).toBe('echo: {"message":"hello"}');

    await client.close();
  });

  it('multiple servers can be connected simultaneously', async () => {
    const serverA = makeInProcessServer('server-alpha', [
      makeToolDef('tool-a1', 'First tool on A'),
      makeToolDef('tool-a2', 'Second tool on A'),
    ]);

    const serverB = makeInProcessServer('server-beta', [makeToolDef('tool-b1', 'First tool on B')]);

    const client = new MCPClient();
    await client.connect(makeInProcessConfig(serverA));
    await client.connect(makeInProcessConfig(serverB));

    const allTools = client.getTools();
    expect(allTools).toHaveLength(3);

    const connections = client.getConnections();
    expect(connections).toHaveLength(2);
    expect(connections.every((c) => c.status === 'connected')).toBe(true);

    await client.close();
    expect(client.getConnections()).toHaveLength(0);
  });

  it('disconnect a specific server keeps other servers intact', async () => {
    const serverA = makeInProcessServer('keep-me', [makeToolDef('tool-keep', 'Kept')]);
    const serverB = makeInProcessServer('remove-me', [makeToolDef('tool-remove', 'Removed')]);

    const client = new MCPClient();
    await client.connect(makeInProcessConfig(serverA));
    await client.connect(makeInProcessConfig(serverB));

    expect(client.getTools()).toHaveLength(2);

    await client.disconnect('remove-me');

    expect(client.getConnections()).toHaveLength(1);
    expect(client.getConnections()[0].name).toBe('keep-me');
    expect(client.getTools()).toHaveLength(1);

    await client.close();
  });

  it('tool names are MCP-namespaced', async () => {
    const server = makeInProcessServer('my-srv', [makeToolDef('my-tool', 'A tool')]);

    const client = new MCPClient();
    await client.connect(makeInProcessConfig(server));

    const tools = client.getTools();
    expect(tools[0].name).toBe('mcp__my-srv__my-tool');

    await client.close();
  });

  it('tool error results throw on call', async () => {
    const server = makeInProcessServer('error-server', [
      makeToolDef('fail-tool', 'Always fails', undefined, async () => ({
        content: [{ type: 'text' as const, text: 'something went wrong' }],
        isError: true,
      })),
    ]);

    const client = new MCPClient();
    await client.connect(makeInProcessConfig(server));

    const tool = client.getTools()[0];
    const ctx = {
      cwd: '/tmp',
      abortSignal: new AbortController().signal,
      tools: [],
      messages: [],
      model: 'test',
      debug: false,
      readFileState: new Map(),
      getState: () => ({}),
      setState: () => {},
    };

    await expect(tool.call({} as any, ctx as any)).rejects.toThrow('something went wrong');

    await client.close();
  });
});
