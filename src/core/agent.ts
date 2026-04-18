/**
 * Agent — the main public API for creating and running agents.
 */
import type { HookConfig } from '../hooks/types.js';
import type { MCPServerConfig } from '../mcp/types.js';
import type { DenialLimits } from '../permissions/rules.js';
import type { PermissionHandler, PermissionMode, PermissionRule } from '../permissions/types.js';
import type { ModelProvider, ToolChoice } from '../providers/types.js';
import type { SDKTool } from '../tools/types.js';
import type { Tracer } from '../tracing/tracer.js';
import { AgentError } from './errors.js';
import type { AgentEvent } from './events.js';
import type {
  InferOutputElement,
  InferOutputPartial,
  InferOutputResult,
  OutputDefinition,
} from './output.js';
import type { AgentSession, SessionOptions } from './session.js';
import type { SessionStore } from './store.js';
import type { DeepPartial, Logger, ThinkingConfig, Usage } from './types.js';

export type StructuredOutputMode = 'strict' | 'mixed';

// ---------------------------------------------------------------------------
// Agent Config
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** Model provider instance */
  provider: ModelProvider;

  /** Model ID (e.g. 'model-id') */
  model: string;

  /** Available tools */
  tools?: SDKTool[];

  /** MCP server configurations */
  mcpServers?: MCPServerConfig[];

  /** Maximum turns (API calls) before stopping */
  maxTurns?: number;

  /** Maximum budget in USD */
  maxBudgetUsd?: number;

  /** Maximum tokens to use */
  maxTokens?: number;

  /** Thinking/reasoning configuration */
  thinkingConfig?: ThinkingConfig;

  /** Custom system prompt (replaces default) */
  systemPrompt?: string;

  /** Additional system prompt (appended to default) */
  appendSystemPrompt?: string;

  /** Permission mode */
  permissionMode?: PermissionMode;

  /** Custom permission handler */
  permissionHandler?: PermissionHandler;

  /** Static permission rules evaluated before the handler */
  permissionRules?: PermissionRule[];

  /** Denial tracking limits (max consecutive/total denials) */
  denialLimits?: DenialLimits;

  /** Tracer instance for structured tracing */
  tracer?: Tracer;

  /** Hook configuration */
  hooks?: HookConfig;

  /** Working directory */
  cwd?: string;

  /** Event callback for monitoring */
  onEvent?: (event: AgentEvent) => void;

  /** Temperature for sampling */
  temperature?: number;

  /** Maximum output tokens per response */
  maxOutputTokens?: number;

  /**
   * Constrain how the model uses the provided tools.
   * See `StreamMessageParams.toolChoice` for semantics and the provider support matrix.
   */
  toolChoice?: ToolChoice;

  /** Context window size in tokens (enables auto-compaction when set) */
  contextWindow?: number;

  /** Auto-compact threshold ratio (0-1, default: 0.8) */
  compactThreshold?: number;

  /** Usage callback fired after each model query */
  onUsage?: (event: UsageCallbackEvent) => void | Promise<void>;

  /** Session persistence store */
  sessionStore?: SessionStore;

  /** Directory containing memory files (.md) to include in system prompt */
  memoryDir?: string;

  /** Workspace root directories for file access boundary enforcement */
  workspaceRoots?: string[];

  /** Whether to enforce workspace boundary (default: false) */
  enforceWorkspaceBoundary?: boolean;

  /**
   * Whether to load compatible instruction files (for example AGENTS.md or
   * CLAUDE.md) from the filesystem when no explicit systemPrompt is provided.
   *
   * Set to `true` for CLI-style agents that should respect project instructions.
   * Defaults to `false` for SDK safety — prevents unintended loading of host
   * filesystem content in server/multi-tenant deployments.
   */
  loadInstructionFiles?: boolean;

  /**
   * Fallback model to use when the primary model is overloaded (529 errors).
   * After `maxConsecutive529s` consecutive 529 responses, the agent loop
   * switches to this model automatically.
   */
  fallbackModel?: string;

  /**
   * Maximum consecutive 529 (overloaded) errors before switching to the
   * fallback model. Default: 3.
   */
  maxConsecutive529s?: number;

  /**
   * Optional structured logger for SDK observability.
   * When provided, the SDK emits structured log entries for key decisions:
   * retries, compaction, permission checks, MCP connections, etc.
   */
  logger?: Logger;

  /**
   * Maximum number of structured-output repair attempts before failing the run.
   *
   * Only applies when the provider uses tool-synthesis to satisfy a structured
   * output (e.g. Anthropic, Bedrock). A repair attempt is consumed each time
   * the model invokes the synthetic structured-output tool with input that
   * fails schema validation. Default: 2.
   */
  maxStructuredOutputRepairs?: number;

  /**
   * How tool-synthesis structured output coexists with normal tools.
   * - `strict`: reserve tool choice for the internal structured-output tool
   * - `mixed`: allow normal tools first, then require the internal tool once
   *   for the final structured answer
   *
   * Default: `strict`
   */
  structuredOutputMode?: StructuredOutputMode;
}

// ---------------------------------------------------------------------------
// Usage Callback Event
// ---------------------------------------------------------------------------

export interface UsageCallbackEvent {
  sessionId?: string;
  turnNumber: number;
  usage: Usage;
  model: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// Agent Interface
// ---------------------------------------------------------------------------

export interface Agent {
  /**
   * Execute a single prompt and return the final result.
   *
   * Pass `output` to receive a typed, validated structured result alongside
   * the usual transcript fields:
   *
   * ```ts
   * const r = await agent.run('extract', {
   *   output: Output.object({ schema: z.object({ name: z.string() }) }),
   * });
   * r.output.name; // typed
   * ```
   */
  run(prompt: string, options?: RunOptions): Promise<AgentResult>;
  run<TOutput extends OutputDefinition<any, any, any>>(
    prompt: string,
    options: RunOptions & { output: TOutput }
  ): Promise<StructuredAgentResult<InferOutputResult<TOutput>>>;

  /**
   * Execute a prompt with streaming events.
   *
   * Pass `output` to receive a structured stream handle exposing
   * `partialOutputStream`, `elementStream` (array outputs only), and an
   * `output` promise that resolves to the validated final value:
   *
   * ```ts
   * const s = agent.stream('extract list', {
   *   output: Output.array({ element: itemSchema }),
   * });
   * for await (const item of s.elementStream) { ... }
   * await s.output;
   * ```
   */
  stream(prompt: string, options?: RunOptions): AsyncGenerator<AgentEvent>;
  stream<TOutput extends OutputDefinition<any, any, any>>(
    prompt: string,
    options: RunOptions & { output: TOutput }
  ): StreamOutputResult<
    InferOutputPartial<TOutput>,
    InferOutputResult<TOutput>,
    InferOutputElement<TOutput>
  >;

  /** Create a multi-turn session (async when resuming from store) */
  createSession(options?: SessionOptions): AgentSession | Promise<AgentSession>;

  /** Abort any in-progress operations */
  abort(): void;

  /** Close the agent, releasing MCP connections and other resources */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Run Options
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Override the system prompt for this run */
  systemPrompt?: string;

  /** Append to system prompt for this run */
  appendSystemPrompt?: string;

  /** Override max turns for this run */
  maxTurns?: number;

  /** Abort signal */
  signal?: AbortSignal;

  /** Override tools for this run */
  tools?: SDKTool[];

  /** Override tool choice for this run */
  toolChoice?: ToolChoice;

  /** Override structured-output tool orchestration mode for this run */
  structuredOutputMode?: StructuredOutputMode;
}

// ---------------------------------------------------------------------------
// Agent Result
// ---------------------------------------------------------------------------

export interface AgentResult {
  /** Final text output (concatenated from all text blocks) */
  text: string;

  /** All output content blocks from the final response */
  content: AgentResultContent[];

  /** The full final assistant message including tool_use, image, etc. blocks */
  finalAssistantMessage?: AgentResultMessage;

  /** Total usage across all turns */
  usage: Usage;

  /** Number of turns taken */
  turns: number;

  /** Stop reason */
  stopReason: string;

  /** Full conversation messages */
  messages: AgentResultMessage[];

  /** Non-fatal errors collected during execution */
  errors?: Array<{ type: string; message: string; turnNumber?: number }>;
}

export interface StructuredAgentResult<T> extends AgentResult {
  /** Parsed and validated structured output produced by the run. */
  output: T;
}

export type OutputStreamEvent<TPartial, TElement = never> =
  | { type: 'text-delta'; textDelta: string }
  | { type: 'object'; object: TPartial }
  | { type: 'element'; element: TElement }
  | { type: 'finish' }
  | { type: 'error'; error: Error };

export interface StreamOutputResult<TPartial, TFinal, TElement = never> {
  /** Raw text deltas from the model (or JSON deltas from the synthetic tool). */
  textStream: AsyncIterable<string>;
  /** Best-effort partial parsed value, deduped on structural change. */
  partialOutputStream: AsyncIterable<DeepPartial<TPartial>>;
  /**
   * Per-element stream for array outputs. Empty for non-array outputs.
   * Yields each element as soon as it can be fully parsed and validated.
   */
  elementStream: AsyncIterable<TElement>;
  /** Combined event stream (text deltas + partials + elements + finish/error). */
  fullStream: AsyncIterable<OutputStreamEvent<DeepPartial<TPartial>, TElement>>;
  /** Underlying agent events (tool calls, thinking, usage, etc.). */
  events: AsyncIterable<AgentEvent>;
  /** Resolves with the validated final structured value. */
  output: Promise<TFinal>;
  /** Resolves with the raw final text (or JSON.stringify(output) for synthesis). */
  text: Promise<string>;
  /** Resolves with the cumulative usage for the run. */
  usage: Promise<Usage>;
}

export interface AgentResultMessage {
  role: 'user' | 'assistant';
  content: AgentResultContent[];
}

export type AgentResultContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; source: unknown }
  | { type: 'document'; source: unknown };

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

export type { AgentSession, SessionOptions };

// Lazy-loaded AgentImpl constructor to avoid circular dependency issues.
// Resolved via async import() — works in both ESM and CJS environments.
let _AgentImplCtor: (new (config: AgentConfig) => Agent) | null = null;

/**
 * Create an agent asynchronously — safe for both ESM and CJS environments.
 * This is the recommended entry point for the SDK.
 */
export async function createAgentAsync(config: AgentConfig): Promise<Agent> {
  if (!_AgentImplCtor) {
    const mod = await import('../loop/agent-impl.js');
    _AgentImplCtor = mod.AgentImpl;
  }
  return new _AgentImplCtor(config);
}

/**
 * Create an agent synchronously.
 *
 * **Important**: In pure ESM environments, this will throw on first call
 * since `require()` is unavailable. Use `createAgentAsync()` instead.
 */
export function createAgent(config: AgentConfig): Agent {
  if (!_AgentImplCtor) {
    // Try synchronous resolution (CJS or bundler-shimmed ESM)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../loop/agent-impl.js') as typeof import('../loop/agent-impl.js');
      _AgentImplCtor = mod.AgentImpl;
    } catch {
      throw new AgentError(
        'Failed to load AgentImpl synchronously. ' +
          'If using pure ESM, use createAgentAsync() instead.',
        'INVALID_CONFIG'
      );
    }
  }
  return new _AgentImplCtor(config);
}
