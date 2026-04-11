/**
 * Permission rule engine — evaluates allow/deny/ask rules with pattern matching.
 * Supports exact match, prefix match, and wildcard patterns for tool inputs.
 *
 * Pattern matching works for:
 * - Bash commands: matches against the `command` or `cmd` field
 * - File tools: matches against the `file_path` field
 * - Web tools: matches against the `url` field
 */

import type { SDKTool } from '../tools/types.js';
import type { PermissionContext, PermissionDecision, PermissionRule } from './types.js';

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

export type ParsedRule =
  | { type: 'exact'; value: string }
  | { type: 'prefix'; value: string }
  | { type: 'wildcard'; pattern: string };

/**
 * Parse a permission rule pattern string.
 *
 * - `"git"` → exact match (for commands: "git" or "git <args>")
 * - `"npm:*"` → prefix match (matches "npm install", "npm run", etc.)
 * - `"/tmp/*"` → wildcard match (matches "/tmp/foo", "/tmp/bar/baz", etc.)
 * - `"git *"` → wildcard match (matches "git status", "git commit", etc.)
 */
export function parseRulePattern(pattern: string): ParsedRule {
  if (pattern.endsWith(':*')) {
    return { type: 'prefix', value: pattern.slice(0, -2) };
  }
  if (pattern.includes('*')) {
    return { type: 'wildcard', pattern };
  }
  return { type: 'exact', value: pattern };
}

/**
 * Match a value against a parsed rule.
 *
 * @param parsed - The parsed rule to match against
 * @param value - The value to match (command string or file path)
 * @param isCommand - When true, exact match also matches "value <args>" (for Bash commands)
 */
export function matchRule(parsed: ParsedRule, value: string, isCommand = false): boolean {
  switch (parsed.type) {
    case 'exact':
      if (isCommand) {
        return value === parsed.value || value.startsWith(`${parsed.value} `);
      }
      return value === parsed.value;
    case 'prefix':
      return value.startsWith(parsed.value);
    case 'wildcard':
      return matchWildcard(parsed.pattern, value);
  }
}

function matchWildcard(pattern: string, input: string): boolean {
  // Escape regex special chars except *
  const regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(input);
}

// ---------------------------------------------------------------------------
// Denial tracking — auto-downgrade after too many denials
// ---------------------------------------------------------------------------

export interface DenialTrackingState {
  consecutiveDenials: number;
  totalDenials: number;
}

const DEFAULT_MAX_CONSECUTIVE_DENIALS = 3;
const DEFAULT_MAX_TOTAL_DENIALS = 20;

export interface DenialLimits {
  maxConsecutive?: number;
  maxTotal?: number;
}

/**
 * Record a denial and return whether the limit has been exceeded.
 */
export function recordDenial(
  state: DenialTrackingState,
  limits: DenialLimits = {}
): { shouldDowngrade: boolean } {
  state.consecutiveDenials++;
  state.totalDenials++;

  const maxConsecutive = limits.maxConsecutive ?? DEFAULT_MAX_CONSECUTIVE_DENIALS;
  const maxTotal = limits.maxTotal ?? DEFAULT_MAX_TOTAL_DENIALS;

  return {
    shouldDowngrade: state.consecutiveDenials >= maxConsecutive || state.totalDenials >= maxTotal,
  };
}

/**
 * Record a successful permission grant (resets consecutive denials).
 */
export function recordAllow(state: DenialTrackingState): void {
  state.consecutiveDenials = 0;
}

// ---------------------------------------------------------------------------
// Rule Engine
// ---------------------------------------------------------------------------

export interface PermissionRuleEngineConfig {
  /** Rules ordered by priority (first match wins) */
  rules: PermissionRule[];
  /** Denial tracking configuration */
  denialLimits?: DenialLimits;
}

/**
 * Evaluate permission rules against a tool call.
 *
 * Evaluation order:
 * 1. Deny rules are checked first (across all rules)
 * 2. Then allow/ask rules in order
 *
 * This ensures deny rules always take precedence, preventing accidental
 * bypasses when an allow rule appears before a deny rule.
 */
export function evaluateRules(
  toolName: string,
  input: unknown,
  rules: PermissionRule[],
  tool?: SDKTool
): PermissionDecision | null {
  // Phase 1: Check deny rules first (deny takes precedence)
  for (const rule of rules) {
    if (rule.behavior !== 'deny') continue;
    if (matchesRule(rule, toolName, input, tool)) {
      return {
        behavior: 'deny',
        message: `Denied by rule: ${rule.toolName}${rule.pattern ? ` (${rule.pattern})` : ''}`,
      };
    }
  }

  // Phase 2: Check allow/ask rules in order (first match wins)
  for (const rule of rules) {
    if (rule.behavior === 'deny') continue; // Already handled
    if (!matchesRule(rule, toolName, input, tool)) continue;

    switch (rule.behavior) {
      case 'allow':
        return { behavior: 'allow' };
      case 'ask':
        return {
          behavior: 'ask',
          message: `Rule requires confirmation: ${rule.toolName}${rule.pattern ? ` (${rule.pattern})` : ''}`,
        };
    }
  }

  return null; // No matching rule
}

/**
 * Check if a single rule matches the given tool name and input.
 */
function matchesRule(
  rule: PermissionRule,
  toolName: string,
  input: unknown,
  tool?: SDKTool
): boolean {
  // Match tool name
  if (rule.toolName !== '*' && rule.toolName !== toolName) return false;

  // If rule has a pattern, match it against the extracted value from input
  if (rule.pattern) {
    const extracted = extractMatchableValue(input, tool);
    // If we can't extract a matchable value, the rule doesn't apply
    if (extracted === null) return false;

    const parsed = parseRulePattern(rule.pattern);
    if (!matchRule(parsed, extracted.value, extracted.isCommand)) return false;
  }

  return true;
}

/**
 * Extract a matchable value from tool input.
 *
 * Supports multiple input shapes:
 * - Tool-defined getPath: uses the tool's own path extraction (custom tools, MCP)
 * - Bash tools: `{ command: string }` or `{ cmd: string }` (isCommand = true)
 * - File tools: `{ file_path: string }`
 * - Web tools: `{ url: string }`
 */
function extractMatchableValue(
  input: unknown,
  tool?: SDKTool
): { value: string; isCommand: boolean } | null {
  // 1. Try tool-defined custom matcher first
  if (tool?.getPath) {
    const path = tool.getPath(input as never);
    if (path) return { value: path, isCommand: false };
  }

  // 2. Fallback to hardcoded field matching (backward compatible)
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    // Bash tools: command/cmd
    if (typeof obj.command === 'string') return { value: obj.command, isCommand: true };
    if (typeof obj.cmd === 'string') return { value: obj.cmd, isCommand: true };
    // File tools: file_path
    if (typeof obj.file_path === 'string') return { value: obj.file_path, isCommand: false };
    // Web tools: url
    if (typeof obj.url === 'string') return { value: obj.url, isCommand: false };
  }
  return null;
}
