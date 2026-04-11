/**
 * Tests for SessionStore implementations.
 */

import { describe, expect, it } from 'vitest';
import { InMemorySessionStore, type SessionData } from '../core/store.js';

const mockSessionData = (id: string, agentId?: string): SessionData => ({
  id,
  agentId,
  messages: [],
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('InMemorySessionStore', () => {
  it('should save and load a session', async () => {
    const store = new InMemorySessionStore();
    const data = mockSessionData('session-1');
    await store.save('session-1', data);

    const loaded = await store.load('session-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('session-1');
  });

  it('should return null for non-existent session', async () => {
    const store = new InMemorySessionStore();
    const loaded = await store.load('non-existent');
    expect(loaded).toBeNull();
  });

  it('should delete a session', async () => {
    const store = new InMemorySessionStore();
    await store.save('session-1', mockSessionData('session-1'));
    await store.delete('session-1');

    const loaded = await store.load('session-1');
    expect(loaded).toBeNull();
  });

  it('should list sessions', async () => {
    const store = new InMemorySessionStore();
    await store.save('session-1', mockSessionData('session-1', 'agent-a'));
    await store.save('session-2', mockSessionData('session-2', 'agent-b'));
    await store.save('session-3', mockSessionData('session-3', 'agent-a'));

    const all = await store.list();
    expect(all).toHaveLength(3);
  });

  it('should filter sessions by agentId', async () => {
    const store = new InMemorySessionStore();
    await store.save('session-1', mockSessionData('session-1', 'agent-a'));
    await store.save('session-2', mockSessionData('session-2', 'agent-b'));
    await store.save('session-3', mockSessionData('session-3', 'agent-a'));

    const filtered = await store.list({ agentId: 'agent-a' });
    expect(filtered).toHaveLength(2);
  });

  it('should limit results', async () => {
    const store = new InMemorySessionStore();
    await store.save('session-1', mockSessionData('session-1'));
    await store.save('session-2', mockSessionData('session-2'));
    await store.save('session-3', mockSessionData('session-3'));

    const limited = await store.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('should update existing session', async () => {
    const store = new InMemorySessionStore();
    const data = mockSessionData('session-1');
    await store.save('session-1', data);

    const updated = { ...data, metadata: { key: 'value' } };
    await store.save('session-1', updated);

    const loaded = await store.load('session-1');
    expect(loaded!.metadata).toEqual({ key: 'value' });
  });
});
