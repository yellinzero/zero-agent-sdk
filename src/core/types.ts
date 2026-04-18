/**
 * Core message types used throughout the agent loop.
 * Provider-agnostic format — each provider maps to/from this.
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  usage?: Usage;
  model?: string;
  stopReason?: StopReason;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | ImageBlock
  | DocumentBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

export interface ImageBlock {
  type: 'image';
  source: ImageSource;
}

export interface ImageSource {
  type: 'base64';
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
}

export interface DocumentBlock {
  type: 'document';
  source: DocumentSource;
}

export interface DocumentSource {
  type: 'base64';
  media_type: 'application/pdf';
  data: string;
}

/**
 * Thinking configuration for extended thinking models.
 */
export interface ThinkingConfig {
  type: 'enabled' | 'disabled';
  budgetTokens?: number;
}

/**
 * Structured logger interface for observability.
 * When provided via AgentConfig, the SDK emits structured log entries
 * for key decisions: retries, compaction triggers, permission checks,
 * MCP connections, etc.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export type DeepPartial<T> = T extends (...args: any[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepPartial<U>[]
    : T extends (infer U)[]
      ? DeepPartial<U>[]
      : T extends object
        ? { [K in keyof T]?: DeepPartial<T[K]> }
        : T;
