/**
 * Agent event types emitted during streaming execution.
 */

import type { Usage } from './types.js';

export type AgentEvent =
  | TextEvent
  | ThinkingEvent
  | ToolUseStartEvent
  | ToolUseEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | UsageEvent
  | ErrorEvent
  | PermissionRequestEvent
  | CompactEvent;

export interface TextEvent {
  type: 'text';
  text: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseStartEvent {
  type: 'tool_use_start';
  toolName: string;
  toolUseId: string;
  input: unknown;
}

export interface ToolUseEndEvent {
  type: 'tool_use_end';
  toolUseId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface TurnStartEvent {
  type: 'turn_start';
  turnNumber: number;
}

export interface TurnEndEvent {
  type: 'turn_end';
  stopReason: string;
  usage: Usage;
}

export interface UsageEvent {
  type: 'usage';
  usage: Usage;
}

export interface ErrorEvent {
  type: 'error';
  error: Error;
}

export interface PermissionRequestEvent {
  type: 'permission_request';
  tool: string;
  input: unknown;
  message?: string;
  resolve: (decision: boolean | { allow: boolean; updatedInput?: unknown }) => void;
}

export interface CompactEvent {
  type: 'compact';
  summary: string;
  method: 'micro' | 'full' | 'truncate';
  messageCount: number;
}
