import { describe, expect, it, vi } from 'vitest';
import { createAgentTool } from '../tools/builtin/agent.js';
import { createAskUserTool } from '../tools/builtin/ask-user.js';
import { builtinTools } from '../tools/builtin/index.js';
import { createTaskCreateTool } from '../tools/builtin/task-create.js';
import { createTaskGetTool } from '../tools/builtin/task-get.js';
import { createTaskListTool } from '../tools/builtin/task-list.js';
import { createTaskOutputTool } from '../tools/builtin/task-output.js';
import { createTaskStopTool } from '../tools/builtin/task-stop.js';
import { InMemoryTaskStore } from '../tools/builtin/task-store.js';
import { createTaskUpdateTool } from '../tools/builtin/task-update.js';
import { createWebFetchTool } from '../tools/builtin/web-fetch.js';
import { createWebSearchTool } from '../tools/builtin/web-search.js';

// ---------------------------------------------------------------------------
// builtinTools backward compatibility
// ---------------------------------------------------------------------------

describe('builtinTools backward compatibility', () => {
  it('should still return 7 tools by default', () => {
    const tools = builtinTools();
    expect(tools).toHaveLength(7);
  });

  it('should include task tools when tasks option is true', () => {
    const tools = builtinTools({ tasks: true });
    expect(tools).toHaveLength(13); // 7 + 6 task tools
    const names = tools.map((t) => t.name);
    expect(names).toContain('TaskCreate');
    expect(names).toContain('TaskUpdate');
    expect(names).toContain('TaskList');
    expect(names).toContain('TaskGet');
    expect(names).toContain('TaskOutput');
    expect(names).toContain('TaskStop');
  });

  it('should include web-fetch when webFetch is true', () => {
    const tools = builtinTools({ webFetch: true });
    expect(tools).toHaveLength(8); // 7 + 1
    expect(tools.map((t) => t.name)).toContain('WebFetch');
  });

  it('should include askUser when enabled', () => {
    const tools = builtinTools({ askUser: true });
    expect(tools).toHaveLength(8);
    expect(tools.map((t) => t.name)).toContain('AskUserQuestion');
  });

  it('should include webSearch when searchFn is provided', () => {
    const tools = builtinTools({
      webSearch: { searchFn: async () => [] },
    });
    expect(tools).toHaveLength(8);
    expect(tools.map((t) => t.name)).toContain('WebSearch');
  });

  it('should include agent when createChildAgent is provided', () => {
    const tools = builtinTools({
      agent: { createChildAgent: async () => ({ agentId: '1' }) },
    });
    expect(tools).toHaveLength(8);
    expect(tools.map((t) => t.name)).toContain('Agent');
  });

  it('should support all new tools together', () => {
    const tools = builtinTools({
      webSearch: { searchFn: async () => [] },
      webFetch: true,
      askUser: true,
      tasks: true,
      agent: { createChildAgent: async () => ({ agentId: '1' }) },
    });
    // 7 + webSearch + webFetch + askUser + 6 tasks + agent = 17
    expect(tools).toHaveLength(17);
  });
});

// ---------------------------------------------------------------------------
// WebSearch tool
// ---------------------------------------------------------------------------

describe('createWebSearchTool', () => {
  it('should create a tool named WebSearch', () => {
    const tool = createWebSearchTool({ searchFn: async () => [] });
    expect(tool.name).toBe('WebSearch');
    expect(tool.isConcurrencySafe({ query: 'test' })).toBe(true);
    expect(tool.isReadOnly({ query: 'test' })).toBe(true);
  });

  it('should validate input schema', () => {
    const tool = createWebSearchTool({ searchFn: async () => [] });
    const result = tool.inputSchema.safeParse({ query: 'test' });
    expect(result.success).toBe(true);
  });

  it('should reject empty query', () => {
    const tool = createWebSearchTool({ searchFn: async () => [] });
    const result = tool.inputSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WebFetch tool
// ---------------------------------------------------------------------------

describe('createWebFetchTool', () => {
  it('should create a tool named WebFetch', () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe('WebFetch');
    expect(tool.isConcurrencySafe({ url: 'https://example.com', prompt: 'test' })).toBe(true);
    expect(tool.isReadOnly({ url: 'https://example.com', prompt: 'test' })).toBe(true);
  });

  it('should validate URL format', () => {
    const tool = createWebFetchTool();
    const good = tool.inputSchema.safeParse({ url: 'https://example.com', prompt: 'test' });
    expect(good.success).toBe(true);

    const bad = tool.inputSchema.safeParse({ url: 'not-a-url', prompt: 'test' });
    expect(bad.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AskUser tool
// ---------------------------------------------------------------------------

describe('createAskUserTool', () => {
  it('should create a tool named AskUserQuestion', () => {
    const tool = createAskUserTool();
    expect(tool.name).toBe('AskUserQuestion');
    expect(tool.aliases).toContain('AskUser');
  });

  it('should return ask permission', async () => {
    const tool = createAskUserTool();
    const result = await tool.checkPermissions({} as any, {} as any);
    expect(result.behavior).toBe('ask');
  });
});

// ---------------------------------------------------------------------------
// Agent tool
// ---------------------------------------------------------------------------

describe('createAgentTool', () => {
  it('should create a tool named Agent', () => {
    const tool = createAgentTool({
      createChildAgent: async () => ({ agentId: 'test-123' }),
    });
    expect(tool.name).toBe('Agent');
    expect(tool.isConcurrencySafe({ description: 'test', prompt: 'do something' })).toBe(false);
    expect(tool.isReadOnly({ description: 'test', prompt: 'do something' })).toBe(false);
  });

  it('should return ask permission with description', async () => {
    const tool = createAgentTool({
      createChildAgent: async () => ({ agentId: 'test-123' }),
    });
    const result = await tool.checkPermissions(
      { description: 'Find files', prompt: 'search' },
      {} as any
    );
    expect(result.behavior).toBe('ask');
    if (result.behavior === 'ask') {
      expect(result.message).toContain('Find files');
    }
  });
});

// ---------------------------------------------------------------------------
// TaskStore
// ---------------------------------------------------------------------------

describe('InMemoryTaskStore', () => {
  it('should create tasks with auto-incrementing IDs', async () => {
    const store = new InMemoryTaskStore();
    const t1 = await store.createTask({
      subject: 'Task 1',
      description: 'Desc 1',
      status: 'pending',
      metadata: {},
    });
    const t2 = await store.createTask({
      subject: 'Task 2',
      description: 'Desc 2',
      status: 'pending',
      metadata: {},
    });
    expect(t1.id).toBe('1');
    expect(t2.id).toBe('2');
  });

  it('should list all tasks', async () => {
    const store = new InMemoryTaskStore();
    await store.createTask({ subject: 'A', description: 'a', status: 'pending', metadata: {} });
    await store.createTask({ subject: 'B', description: 'b', status: 'pending', metadata: {} });
    const tasks = await store.listTasks();
    expect(tasks).toHaveLength(2);
  });

  it('should update task status', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.createTask({
      subject: 'Test',
      description: 'test',
      status: 'pending',
      metadata: {},
    });
    const updated = await store.updateTask(task.id, { status: 'in_progress' });
    expect(updated.status).toBe('in_progress');
  });

  it('should handle metadata merge with null deletion', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.createTask({
      subject: 'Test',
      description: 'test',
      status: 'pending',
      metadata: { key1: 'value1', key2: 'value2' },
    });
    const updated = await store.updateTask(task.id, {
      metadata: { key1: null, key3: 'value3' },
    });
    expect(updated.metadata.key1).toBeUndefined();
    expect(updated.metadata.key2).toBe('value2');
    expect(updated.metadata.key3).toBe('value3');
  });

  it('should delete tasks', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.createTask({
      subject: 'Test',
      description: 'test',
      status: 'pending',
      metadata: {},
    });
    await store.deleteTask(task.id);
    expect(await store.getTask(task.id)).toBeNull();
  });

  it('should manage blocks/blockedBy bidirectionally', async () => {
    const store = new InMemoryTaskStore();
    const t1 = await store.createTask({
      subject: 'A',
      description: 'a',
      status: 'pending',
      metadata: {},
    });
    const t2 = await store.createTask({
      subject: 'B',
      description: 'b',
      status: 'pending',
      metadata: {},
    });

    await store.addBlocks(t1.id, [t2.id]);

    const a = await store.getTask(t1.id);
    const b = await store.getTask(t2.id);
    expect(a!.blocks).toContain(t2.id);
    expect(b!.blockedBy).toContain(t1.id);
  });

  it('should throw when updating non-existent task', async () => {
    const store = new InMemoryTaskStore();
    await expect(store.updateTask('999', { status: 'completed' })).rejects.toThrow(
      'Task not found'
    );
  });
});

// ---------------------------------------------------------------------------
// Task tools
// ---------------------------------------------------------------------------

describe('Task tools', () => {
  it('createTaskCreateTool returns tool named TaskCreate', () => {
    const store = new InMemoryTaskStore();
    const tool = createTaskCreateTool(store);
    expect(tool.name).toBe('TaskCreate');
    expect(tool.isConcurrencySafe({ subject: 'x', description: 'y' })).toBe(false);
    expect(tool.isReadOnly({ subject: 'x', description: 'y' })).toBe(false);
  });

  it('createTaskUpdateTool returns tool named TaskUpdate', () => {
    const store = new InMemoryTaskStore();
    const tool = createTaskUpdateTool(store);
    expect(tool.name).toBe('TaskUpdate');
  });

  it('createTaskListTool returns read-only concurrency-safe tool', () => {
    const store = new InMemoryTaskStore();
    const tool = createTaskListTool(store);
    expect(tool.name).toBe('TaskList');
    expect(tool.isConcurrencySafe({})).toBe(true);
    expect(tool.isReadOnly({})).toBe(true);
  });

  it('createTaskGetTool returns read-only concurrency-safe tool', () => {
    const store = new InMemoryTaskStore();
    const tool = createTaskGetTool(store);
    expect(tool.name).toBe('TaskGet');
    expect(tool.isConcurrencySafe({ taskId: '1' })).toBe(true);
    expect(tool.isReadOnly({ taskId: '1' })).toBe(true);
  });

  it('createTaskOutputTool returns read-only concurrency-safe tool', () => {
    const store = new InMemoryTaskStore();
    const tool = createTaskOutputTool(store);
    expect(tool.name).toBe('TaskOutput');
    expect(tool.isConcurrencySafe({ taskId: '1', block: true, timeout: 30000 })).toBe(true);
    expect(tool.isReadOnly({ taskId: '1', block: true, timeout: 30000 })).toBe(true);
  });

  it('createTaskStopTool returns non-read-only tool', () => {
    const store = new InMemoryTaskStore();
    const tool = createTaskStopTool(store);
    expect(tool.name).toBe('TaskStop');
    expect(tool.isConcurrencySafe({ taskId: '1' })).toBe(false);
    expect(tool.isReadOnly({ taskId: '1' })).toBe(false);
  });
});
