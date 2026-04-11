/**
 * Task store — in-memory task tracking for agent workflows.
 * Provides a TaskStore interface and a default InMemoryTaskStore implementation.
 */

import { ToolExecutionError } from '../../core/errors.js';

// ---------------------------------------------------------------------------
// Task type
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'stopped';
  owner?: string;
  activeForm?: string;
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// TaskStore interface
// ---------------------------------------------------------------------------

export interface TaskStore {
  createTask(
    data: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'blocks' | 'blockedBy'>
  ): Promise<Task>;

  updateTask(
    id: string,
    updates: Partial<
      Pick<Task, 'subject' | 'description' | 'status' | 'owner' | 'activeForm' | 'metadata'>
    >
  ): Promise<Task>;

  getTask(id: string): Promise<Task | null>;

  listTasks(): Promise<Task[]>;

  deleteTask(id: string): Promise<void>;

  addBlocks(taskId: string, blockedTaskIds: string[]): Promise<void>;

  addBlockedBy(taskId: string, blockerTaskIds: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemoryTaskStore
// ---------------------------------------------------------------------------

export class InMemoryTaskStore implements TaskStore {
  private tasks = new Map<string, Task>();
  private nextId = 1;

  async createTask(
    data: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'blocks' | 'blockedBy'>
  ): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      ...data,
      id: String(this.nextId++),
      blocks: [],
      blockedBy: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async updateTask(
    id: string,
    updates: Partial<
      Pick<Task, 'subject' | 'description' | 'status' | 'owner' | 'activeForm' | 'metadata'>
    >
  ): Promise<Task> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new ToolExecutionError(`Task not found: ${id}`, 'TaskStore');
    }

    if (updates.metadata) {
      const merged = { ...task.metadata };
      for (const [key, value] of Object.entries(updates.metadata)) {
        if (value === null) {
          delete merged[key];
        } else {
          merged[key] = value;
        }
      }
      task.metadata = merged;
    }

    if (updates.subject !== undefined) task.subject = updates.subject;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.status !== undefined) task.status = updates.status;
    if (updates.owner !== undefined) task.owner = updates.owner;
    if (updates.activeForm !== undefined) task.activeForm = updates.activeForm;
    task.updatedAt = Date.now();

    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async listTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks.delete(id);
  }

  async addBlocks(taskId: string, blockedTaskIds: string[]): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new ToolExecutionError(`Task not found: ${taskId}`, 'TaskStore');

    for (const blockedId of blockedTaskIds) {
      if (!task.blocks.includes(blockedId)) {
        task.blocks.push(blockedId);
      }
      // Also update the reverse relation
      const blockedTask = this.tasks.get(blockedId);
      if (blockedTask && !blockedTask.blockedBy.includes(taskId)) {
        blockedTask.blockedBy.push(taskId);
      }
    }
    task.updatedAt = Date.now();
  }

  async addBlockedBy(taskId: string, blockerTaskIds: string[]): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new ToolExecutionError(`Task not found: ${taskId}`, 'TaskStore');

    for (const blockerId of blockerTaskIds) {
      if (!task.blockedBy.includes(blockerId)) {
        task.blockedBy.push(blockerId);
      }
      // Also update the reverse relation
      const blockerTask = this.tasks.get(blockerId);
      if (blockerTask && !blockerTask.blocks.includes(taskId)) {
        blockerTask.blocks.push(taskId);
      }
    }
    task.updatedAt = Date.now();
  }
}
