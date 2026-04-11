/**
 * MCP retry test — verifies connection retry logic and failure event emission.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Test the MCP connection retry logic from AgentImpl
describe('MCP connection retry', () => {
  it('retries failed connections up to MAX_MCP_RETRIES', async () => {
    const { AgentImpl } = await import('../loop/agent-impl.js');

    const connectAttempts: string[] = [];
    const failCount = 0;

    // Create a minimal mock config
    const mockProvider = {
      providerId: 'test',
      async *streamMessage(): any {},
      async generateMessage(): any {
        return { content: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
      },
      getModelInfo: () => ({
        contextWindow: 100_000,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsToolUse: true,
      }),
    };

    const errorEvents: any[] = [];

    const agent = new AgentImpl({
      provider: mockProvider as any,
      model: 'test-model',
      mcpServers: [{ name: 'failing-server', command: 'false', args: [] } as any],
      onEvent: (event: any) => {
        if (event.type === 'error') errorEvents.push(event);
      },
    });

    // Mock MCP client
    const mockMcpClient = {
      connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
      getTools: vi.fn().mockReturnValue([]),
      getConnections: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Inject mock MCP client
    (agent as any).mcpClient = mockMcpClient;

    // Call connectMCPServers multiple times (via ensureMCPConnected)
    await agent.ensureMCPConnected();
    expect(mockMcpClient.connect).toHaveBeenCalledTimes(1);
    expect(errorEvents.length).toBe(1);

    await agent.ensureMCPConnected();
    expect(mockMcpClient.connect).toHaveBeenCalledTimes(2);

    await agent.ensureMCPConnected();
    expect(mockMcpClient.connect).toHaveBeenCalledTimes(3);

    // After 3 failures, should not retry anymore
    await agent.ensureMCPConnected();
    expect(mockMcpClient.connect).toHaveBeenCalledTimes(3); // Still 3 — no more retries
    expect(errorEvents.length).toBe(3);

    await agent.close();
  });

  it('does not retry already connected servers', async () => {
    const { AgentImpl } = await import('../loop/agent-impl.js');

    const mockProvider = {
      providerId: 'test',
      async *streamMessage(): any {},
      async generateMessage(): any {
        return { content: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
      },
      getModelInfo: () => ({
        contextWindow: 100_000,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsToolUse: true,
      }),
    };

    const agent = new AgentImpl({
      provider: mockProvider as any,
      model: 'test-model',
      mcpServers: [{ name: 'server-a', command: 'test', args: [] } as any],
    });

    const mockMcpClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getTools: vi.fn().mockReturnValue([]),
      getConnections: vi.fn().mockReturnValue([{ name: 'server-a', status: 'connected' }]),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (agent as any).mcpClient = mockMcpClient;

    await agent.ensureMCPConnected();
    // Should not attempt to connect already-connected server
    expect(mockMcpClient.connect).not.toHaveBeenCalled();

    await agent.close();
  });
});
