/**
 * SessionStore — interface and implementations for session persistence.
 */

import type { ProviderMessage } from '../providers/types.js';
import type { Usage } from './types.js';

// ---------------------------------------------------------------------------
// Session Data
// ---------------------------------------------------------------------------

export interface SessionData {
  /** Session ID */
  id: string;
  /** Agent ID (optional grouping key) */
  agentId?: string;
  /** Conversation messages */
  messages: ProviderMessage[];
  /** Cumulative usage */
  usage: Usage;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// SessionStore Interface
// ---------------------------------------------------------------------------

export interface SessionStore {
  /** Save or update a session */
  save(sessionId: string, data: SessionData): Promise<void>;
  /** Load a session by ID */
  load(sessionId: string): Promise<SessionData | null>;
  /** Delete a session */
  delete(sessionId: string): Promise<void>;
  /** List session IDs with optional filters */
  list(filter?: { agentId?: string; limit?: number }): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// InMemorySessionStore
// ---------------------------------------------------------------------------

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionData>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 1000;
    this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000; // 24h default
  }

  async save(sessionId: string, data: SessionData): Promise<void> {
    this.sessions.set(sessionId, { ...data, updatedAt: Date.now() });
    this.evictIfNeeded();
  }

  async load(sessionId: string): Promise<SessionData | null> {
    const data = this.sessions.get(sessionId) ?? null;
    if (data && Date.now() - data.updatedAt > this.ttlMs) {
      this.sessions.delete(sessionId);
      return null;
    }
    return data ? structuredClone(data) : null;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async list(filter?: { agentId?: string; limit?: number }): Promise<string[]> {
    let entries = Array.from(this.sessions.entries());

    if (filter?.agentId) {
      entries = entries.filter(([, data]) => data.agentId === filter.agentId);
    }

    // Sort by updatedAt descending
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);

    if (filter?.limit) {
      entries = entries.slice(0, filter.limit);
    }

    return entries.map(([id]) => id);
  }

  private evictIfNeeded(): void {
    if (this.sessions.size <= this.maxEntries) return;
    // LRU: remove least recently updated entries
    const sorted = [...this.sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const toRemove = sorted.slice(0, sorted.length - this.maxEntries);
    for (const [id] of toRemove) {
      this.sessions.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// FileSessionStore
// ---------------------------------------------------------------------------

export class FileSessionStore implements SessionStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private sessionPath(sessionId: string): string {
    // Use SHA-256 hash to avoid collisions from sanitization.
    // Keep a readable prefix for debugging.
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
    const prefix = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    return `${this.baseDir}/${prefix}_${hash}.json`;
  }

  async save(sessionId: string, data: SessionData): Promise<void> {
    const { mkdir, rename, unlink } = await import('node:fs/promises');
    const { open } = await import('node:fs/promises');
    await mkdir(this.baseDir, { recursive: true });
    const serializable = {
      ...data,
      metadata: data.metadata ? filterSerializable(data.metadata) : undefined,
      updatedAt: Date.now(),
    };
    const json = JSON.stringify(serializable, null, 2);

    const targetPath = this.sessionPath(sessionId);
    const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;

    try {
      // Write to temporary file first with explicit flush for Node 18 compat
      const fd = await open(tempPath, 'w');
      try {
        await fd.writeFile(json, { encoding: 'utf-8' });
        await fd.sync();
      } finally {
        await fd.close();
      }
      // Atomic rename — prevents corruption from crashes during write
      await rename(tempPath, targetPath);
    } catch (error) {
      // Clean up temporary file on failure
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup failure
      }
      throw error;
    }
  }

  async load(sessionId: string): Promise<SessionData | null> {
    const { readFile } = await import('node:fs/promises');
    try {
      const json = await readFile(this.sessionPath(sessionId), 'utf-8');
      return JSON.parse(json) as SessionData;
    } catch {
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    try {
      await unlink(this.sessionPath(sessionId));
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async list(filter?: { agentId?: string; limit?: number }): Promise<string[]> {
    const { readdir, readFile } = await import('node:fs/promises');
    try {
      const files = await readdir(this.baseDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      let sessions: Array<{ id: string; updatedAt: number; agentId?: string }> = [];

      for (const file of jsonFiles) {
        try {
          const json = await readFile(`${this.baseDir}/${file}`, 'utf-8');
          const data = JSON.parse(json) as SessionData;
          sessions.push({
            id: data.id,
            updatedAt: data.updatedAt,
            agentId: data.agentId,
          });
        } catch {
          // Skip invalid files
        }
      }

      if (filter?.agentId) {
        sessions = sessions.filter((s) => s.agentId === filter.agentId);
      }

      sessions.sort((a, b) => b.updatedAt - a.updatedAt);

      if (filter?.limit) {
        sessions = sessions.slice(0, filter.limit);
      }

      return sessions.map((s) => s.id);
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Serialization helper
// ---------------------------------------------------------------------------

/**
 * Filter out non-serializable values from a metadata object.
 * Removes runtime objects like BackgroundTaskManager, Promises, AbortControllers, etc.
 */
function filterSerializable(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip functions
    if (typeof value === 'function') continue;
    // Skip undefined
    if (value === undefined) continue;
    // Skip non-plain objects (class instances, Map, Set, etc.)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const proto = Object.getPrototypeOf(value);
      if (proto !== null && proto !== Object.prototype) {
        continue; // Skip class instances
      }
    }
    // Verify JSON-serializable
    try {
      JSON.stringify(value);
      result[key] = value;
    } catch {
      // Skip non-serializable values
    }
  }
  return result;
}
