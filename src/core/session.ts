/**
 * AgentSession — multi-turn conversation state management.
 */

import type { ProviderMessage } from '../providers/types.js';
import type { AgentEvent } from './events.js';
import type { Usage } from './types.js';

// ---------------------------------------------------------------------------
// Session Options
// ---------------------------------------------------------------------------

export interface SessionOptions {
  /** Session ID (auto-generated if not provided) */
  id?: string;

  /** Resume an existing session from store by ID */
  resumeId?: string;

  /** Initial messages to seed the conversation */
  initialMessages?: ProviderMessage[];

  /** Maximum context window usage before auto-compaction (0-1 ratio) */
  compactThreshold?: number;

  /** Override system prompt for this session */
  systemPrompt?: string;
}

// ---------------------------------------------------------------------------
// Session Interface
// ---------------------------------------------------------------------------

export interface AgentSession {
  /** Unique session identifier */
  readonly id: string;

  /** Send a message and stream events */
  send(prompt: string): AsyncGenerator<AgentEvent>;

  /** Get the full conversation message history */
  getMessages(): ProviderMessage[];

  /** Get cumulative usage statistics */
  getUsage(): Usage;

  /** Get current context window token count estimate */
  getContextTokenCount(): number;

  /** Manually trigger context compaction */
  compact(): Promise<string>;

  /** Abort any in-progress operations */
  abort(): void;

  /** Clean up session resources */
  close(): Promise<void>;
}
