/**
 * AgentImpl — the concrete implementation of the Agent interface.
 * Orchestrates the agent loop, session management, event streaming,
 * MCP auto-connect, and appendSystemPrompt.
 */

import { randomUUID } from 'crypto';
import { compactMessages, microCompact } from '../context/compact.js';
import { loadInstructionFiles, loadMemoryFiles } from '../context/memory.js';
import { buildSystemPrompt as buildSystemPromptFromConfig } from '../context/system-prompt.js';
import type {
  Agent,
  AgentConfig,
  AgentResult,
  AgentResultContent,
  AgentResultMessage,
  RunOptions,
} from '../core/agent.js';
import { AgentError } from '../core/errors.js';
import type { AgentEvent } from '../core/events.js';
import type { AgentSession, SessionOptions } from '../core/session.js';
import type { Usage } from '../core/types.js';
import { MCPClient } from '../mcp/client.js';
import { normalizeServerName } from '../mcp/normalization.js';
import type { MCPConnection } from '../mcp/types.js';
import type { ProviderContentBlock, ProviderMessage } from '../providers/types.js';
import {
  BackgroundTaskManager,
  BG_MANAGER_KEY,
  type SerializableTaskState,
} from '../tools/builtin/background-task.js';
import type { AgentSessionState, SDKTool } from '../tools/types.js';
import { createLinkedAbortController } from '../utils/abort.js';
import { AsyncQueue } from '../utils/async-queue.js';
import { createUserMessage, extractText } from '../utils/messages.js';
import { merge } from '../utils/streaming.js';
import { addUsage, emptyUsage, estimateMessagesTokenCount } from '../utils/tokens.js';
import { type AgentLoopConfig, agentLoop } from './query.js';

// ---------------------------------------------------------------------------
// Agent Implementation
// ---------------------------------------------------------------------------

export class AgentImpl implements Agent {
  private config: AgentConfig;
  private abortController: AbortController;
  private mcpClient: MCPClient | null = null;
  private mcpTools: SDKTool[] = [];
  private mcpRetryCount = new Map<string, number>();
  private static readonly MAX_MCP_RETRIES = 3;
  private isRunning = false;

  constructor(config: AgentConfig) {
    this.config = {
      cwd: process.cwd(),
      maxTurns: 100,
      permissionMode: 'default',
      ...config,
    };
    this.abortController = new AbortController();
  }

  /**
   * Build a complete AgentLoopConfig from the agent's config and per-call overrides.
   * Centralizes all config assembly to prevent field omission bugs between
   * runLoop() and doSend().
   */
  buildLoopConfig(overrides: {
    tools: SDKTool[];
    systemPrompt: string;
    signal: AbortSignal;
    emitEvent: (event: AgentEvent) => void;
    maxTurns?: number;
    cwd?: string;
    sessionId?: string;
    compactThreshold?: number;
    sessionState?: import('../tools/types.js').AgentSessionState;
    readFileState?: Map<string, import('../tools/types.js').ReadFileStateEntry>;
    onCwdChange?: (newCwd: string) => void;
  }): AgentLoopConfig {
    return {
      provider: this.config.provider,
      model: this.config.model,
      thinkingConfig: this.config.thinkingConfig,
      maxTurns: overrides.maxTurns ?? this.config.maxTurns ?? 100,
      maxBudgetUsd: this.config.maxBudgetUsd,
      maxTokens: this.config.maxTokens,
      maxOutputTokens: this.config.maxOutputTokens,
      temperature: this.config.temperature,
      permissionMode: this.config.permissionMode ?? 'default',
      permissionHandler: this.config.permissionHandler,
      permissionRules: this.config.permissionRules,
      denialLimits: this.config.denialLimits,
      tracer: this.config.tracer,
      hooks: this.config.hooks,
      cwd: overrides.cwd ?? this.config.cwd ?? process.cwd(),
      contextWindow: this.config.contextWindow,
      compactThreshold: overrides.compactThreshold ?? this.config.compactThreshold,
      onUsage: this.config.onUsage,
      workspaceRoots: this.config.workspaceRoots,
      enforceWorkspaceBoundary: this.config.enforceWorkspaceBoundary,
      fallbackModel: this.config.fallbackModel,
      maxConsecutive529s: this.config.maxConsecutive529s,
      logger: this.config.logger,
      tools: overrides.tools,
      systemPrompt: overrides.systemPrompt,
      signal: overrides.signal,
      emitEvent: overrides.emitEvent,
      sessionId: overrides.sessionId,
      sessionState: overrides.sessionState,
      readFileState: overrides.readFileState,
      onCwdChange: overrides.onCwdChange,
    };
  }

  async run(prompt: string, options?: RunOptions): Promise<AgentResult> {
    const collectedErrors: Array<{ type: string; message: string; turnNumber?: number }> = [];
    let finalUsage = emptyUsage();
    let turns = 0;
    let finalStopReason = 'end_turn';
    let currentTurn = 0;

    // Track only the last turn's text/thinking for AgentResult
    let lastTurnTexts: string[] = [];
    let lastTurnThinking: AgentResultContent[] = [];

    // Track the last assistant message for finalAssistantMessage
    let finalAssistantMessage: ProviderMessage | undefined;

    // Shared messages array — agentLoop mutates it in-place
    const messages: ProviderMessage[] = [createUserMessage(prompt)];

    for await (const event of this.runLoop(messages, options)) {
      this.config.onEvent?.(event);

      if (event.type === 'turn_start') {
        currentTurn = event.turnNumber;
        lastTurnTexts = [];
        lastTurnThinking = [];
      }
      if (event.type === 'text') {
        lastTurnTexts.push(event.text);
      }
      if (event.type === 'thinking') {
        lastTurnThinking.push({ type: 'thinking', thinking: event.thinking });
      }
      if (event.type === 'usage') {
        finalUsage = event.usage;
      }
      if (event.type === 'error') {
        collectedErrors.push({
          type: event.error instanceof Error ? event.error.constructor.name : 'Error',
          message: event.error instanceof Error ? event.error.message : String(event.error),
          turnNumber: currentTurn,
        });
      }
      if (event.type === 'turn_end') {
        turns++;
        finalStopReason = event.stopReason;
        finalUsage = event.usage;
        // Capture the last assistant message from the messages array
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]?.role === 'assistant') {
            finalAssistantMessage = messages[i];
            break;
          }
        }
      }
    }

    // Build result content from last turn only
    const text = lastTurnTexts.join('');
    const content: AgentResultContent[] = [...lastTurnThinking];
    if (text) {
      content.push({ type: 'text', text });
    }

    return {
      text,
      content,
      finalAssistantMessage: finalAssistantMessage
        ? {
            role: finalAssistantMessage.role,
            content: convertProviderContentBlocks(finalAssistantMessage.content),
          }
        : undefined,
      usage: finalUsage,
      turns,
      stopReason: finalStopReason,
      messages: convertProviderMessages(messages),
      errors: collectedErrors.length > 0 ? collectedErrors : undefined,
    };
  }

  async *stream(prompt: string, options?: RunOptions): AsyncGenerator<AgentEvent> {
    const messages: ProviderMessage[] = [createUserMessage(prompt)];

    for await (const event of this.runLoop(messages, options)) {
      this.config.onEvent?.(event);
      yield event;
    }
  }

  private async buildSystemPromptAsync(
    tools: SDKTool[],
    override?: string,
    appendOverride?: string
  ): Promise<string> {
    const explicitBase = override ?? this.config.systemPrompt;
    const append = appendOverride ?? this.config.appendSystemPrompt ?? '';

    if (explicitBase !== undefined) {
      // User provided an explicit system prompt — use as-is, with optional append
      return append ? `${explicitBase}\n\n${append}` : explicitBase;
    }

    // No explicit prompt — build from instruction files and tool descriptions
    const cwd = this.config.cwd ?? process.cwd();
    let instructionContent: string | undefined;

    // Only load instruction files if explicitly opted in (SDK safety default)
    if (this.config.loadInstructionFiles) {
      try {
        instructionContent = (await loadInstructionFiles({ projectRoot: cwd })) || undefined;
      } catch {
        // Instruction file loading is non-fatal
      }
    }

    let memoryContent: string | undefined;
    if (this.config.memoryDir) {
      try {
        memoryContent = (await loadMemoryFiles(this.config.memoryDir)) || undefined;
      } catch {
        // Memory file loading is non-fatal
      }
    }

    let builtPrompt = await buildSystemPromptFromConfig({
      tools,
      instructionContent,
      memoryContent,
    });

    if (append) {
      builtPrompt = `${builtPrompt}\n\n${append}`;
    }

    return builtPrompt;
  }

  /**
   * Connect to configured MCP servers. Retries previously failed servers
   * up to MAX_MCP_RETRIES times. Emits error events for failures.
   */
  private async connectMCPServers(): Promise<SDKTool[]> {
    if (!this.config.mcpServers?.length) return this.mcpTools;

    if (!this.mcpClient) {
      this.mcpClient = new MCPClient();
    }

    // Determine which servers need connection attempts
    const connections: MCPConnection[] = this.mcpClient.getConnections?.() ?? [];
    const connectedNames = new Set(
      connections.filter((c) => c.status === 'connected').map((c) => c.name)
    );

    const serversToConnect = this.config.mcpServers.filter((sc) => {
      // Use normalized name for consistent comparison with MCPClient internals
      const name = normalizeServerName(sc.name);
      if (connectedNames.has(name)) return false;
      const retries = this.mcpRetryCount.get(name) ?? 0;
      return retries < AgentImpl.MAX_MCP_RETRIES;
    });

    if (serversToConnect.length > 0) {
      const results = await Promise.allSettled(
        serversToConnect.map(async (serverConfig) => {
          const normalizedName = normalizeServerName(serverConfig.name);
          try {
            this.config.logger?.info('MCP connecting', { server: serverConfig.name });
            await this.mcpClient!.connect(serverConfig);
            // Clear retry count on success
            this.mcpRetryCount.delete(normalizedName);
          } catch (err) {
            const retries = (this.mcpRetryCount.get(normalizedName) ?? 0) + 1;
            this.mcpRetryCount.set(normalizedName, retries);
            throw new AgentError(
              `MCP server '${serverConfig.name}' connection failed (attempt ${retries}/${AgentImpl.MAX_MCP_RETRIES})`,
              'MCP_ERROR',
              err instanceof Error ? err : undefined
            );
          }
        })
      );

      // Emit error events for failed connections
      for (const result of results) {
        if (result.status === 'rejected') {
          this.config.onEvent?.({
            type: 'error',
            error:
              result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          });
        }
      }
    }

    this.mcpTools = this.mcpClient.getTools();
    return this.mcpTools;
  }

  private async *runLoop(
    messages: ProviderMessage[],
    options?: RunOptions
  ): AsyncGenerator<AgentEvent> {
    if (this.isRunning) {
      throw new AgentError(
        'Agent is already running. Await or abort the current run before starting a new one.',
        'INVALID_CONFIG'
      );
    }
    this.isRunning = true;

    try {
      const linkedController = createLinkedAbortController(
        this.abortController.signal,
        options?.signal
      );

      // Auto-connect MCP servers (1.3)
      const mcpTools = await this.connectMCPServers();

      // Merge user tools + MCP tools
      const userTools = options?.tools ?? this.config.tools ?? [];
      const allTools = mcpTools.length > 0 ? [...userTools, ...mcpTools] : userTools;

      // Build system prompt (async — loads instruction files if no explicit prompt)
      const systemPrompt = await this.buildSystemPromptAsync(
        allTools,
        options?.systemPrompt,
        options?.appendSystemPrompt
      );

      const sideChannel = new AsyncQueue<AgentEvent>();

      const loopConfig = this.buildLoopConfig({
        tools: allTools,
        systemPrompt,
        signal: linkedController.signal,
        maxTurns: options?.maxTurns,
        emitEvent: (event) => {
          sideChannel.push(event);
        },
      });

      // Use an async wrapper that closes sideChannel when the loop finishes
      const loopWithCleanup = async function* () {
        try {
          yield* agentLoop(messages, loopConfig);
        } finally {
          sideChannel.close();
        }
      };

      yield* merge([loopWithCleanup(), sideChannel]);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Build system prompt for session usage (delegates to buildSystemPromptAsync).
   * Public so that AgentSessionImpl can access it.
   */
  buildSystemPromptForSession(
    tools: SDKTool[],
    override?: string,
    appendOverride?: string
  ): Promise<string> {
    return this.buildSystemPromptAsync(tools, override, appendOverride);
  }

  createSession(options?: SessionOptions): AgentSession | Promise<AgentSession> {
    if (options?.resumeId && this.config.sessionStore) {
      return AgentSessionImpl.fromStore(
        this.config,
        this,
        options.resumeId,
        this.config.sessionStore,
        options
      );
    }
    return new AgentSessionImpl(this.config, this, options);
  }

  abort(): void {
    this.abortController.abort();
    this.abortController = new AbortController();
  }

  async close(): Promise<void> {
    this.abort();
    await this.closeMCP();
  }

  /** Get MCP tools (for session sharing) */
  getMCPTools(): SDKTool[] {
    return this.mcpTools;
  }

  /** Connect MCP (for session usage) */
  ensureMCPConnected(): Promise<SDKTool[]> {
    return this.connectMCPServers();
  }

  /** Disconnect all MCP servers */
  async closeMCP(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.mcpClient = null;
      this.mcpTools = [];
      this.mcpRetryCount.clear();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a single ProviderContentBlock to AgentResultContent.
 * Unlike the old version, this preserves all block types including image/document.
 */
function convertSingleBlock(b: ProviderContentBlock): AgentResultContent {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: b.input,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
        is_error: b.is_error,
      };
    case 'thinking':
      return { type: 'thinking', thinking: b.thinking };
    case 'image':
      return { type: 'image', source: b.source };
    case 'document':
      return { type: 'document', source: b.source };
    default:
      // For any unknown block types, serialize as text rather than returning empty string
      return { type: 'text', text: JSON.stringify(b) };
  }
}

function convertProviderContentBlocks(blocks: ProviderContentBlock[]): AgentResultContent[] {
  return blocks.map(convertSingleBlock);
}

function convertProviderMessages(messages: ProviderMessage[]): AgentResultMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: convertProviderContentBlocks(m.content),
  }));
}

// ---------------------------------------------------------------------------
// Session Implementation
// ---------------------------------------------------------------------------

class AgentSessionImpl implements AgentSession {
  readonly id: string;
  private config: AgentConfig;
  private agentImpl: AgentImpl;
  private sessionOptions?: SessionOptions;
  private messages: ProviderMessage[] = [];
  private cumulativeUsage: Usage = emptyUsage();
  private abortController = new AbortController();
  private createdAt: number;

  // Session-scoped state that persists across send() calls
  private sessionState: AgentSessionState = {};
  private readFileState = new Map<string, import('../tools/types.js').ReadFileStateEntry>();
  private currentCwd: string;

  // Serialization lock — ensures only one send() runs at a time
  private sendLock: Promise<void> = Promise.resolve();

  constructor(config: AgentConfig, agentImpl: AgentImpl, options?: SessionOptions) {
    this.id = options?.id ?? options?.resumeId ?? randomUUID();
    this.config = config;
    this.agentImpl = agentImpl;
    this.sessionOptions = options;
    this.createdAt = Date.now();
    this.currentCwd = config.cwd ?? process.cwd();

    if (options?.initialMessages) {
      this.messages = [...options.initialMessages];
    }
  }

  /**
   * Restore a session from the session store.
   */
  static async fromStore(
    config: AgentConfig,
    agentImpl: AgentImpl,
    resumeId: string,
    store: import('../core/store.js').SessionStore,
    options?: SessionOptions
  ): Promise<AgentSessionImpl> {
    const data = await store.load(resumeId);
    const session = new AgentSessionImpl(config, agentImpl, {
      ...options,
      id: resumeId,
    });

    if (data) {
      session.messages = data.messages;
      session.cumulativeUsage = data.usage;
      session.createdAt = data.createdAt;
      // Restore session-scoped state
      if (data.metadata?.sessionState) {
        session.sessionState = data.metadata.sessionState as AgentSessionState;
      }
      if (data.metadata?.lastCwd && typeof data.metadata.lastCwd === 'string') {
        session.currentCwd = data.metadata.lastCwd;
      }
      // Restore background task state (status/output only — running tasks become 'stopped')
      if (data.metadata?.backgroundTasks && Array.isArray(data.metadata.backgroundTasks)) {
        const bgManager = BackgroundTaskManager.fromSerializable(
          data.metadata.backgroundTasks as SerializableTaskState[]
        );
        session.sessionState[BG_MANAGER_KEY] = bgManager;
      }
      // Restore readFileState for read-before-write safety
      if (data.metadata?.readFileState && Array.isArray(data.metadata.readFileState)) {
        for (const [path, entry] of data.metadata.readFileState as Array<[string, any]>) {
          if (typeof path === 'string' && entry) {
            session.readFileState.set(path, entry);
          }
        }
      }
    }

    return session;
  }

  async *send(prompt: string): AsyncGenerator<AgentEvent> {
    // Serialize concurrent send() calls via Promise chain lock.
    // Each send() waits for the previous one to fully complete before starting.
    let releaseLock!: () => void;
    const prevLock = this.sendLock;
    this.sendLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await prevLock;

    try {
      yield* this.doSend(prompt);
    } finally {
      releaseLock();
    }
  }

  private async *doSend(prompt: string): AsyncGenerator<AgentEvent> {
    this.messages.push(createUserMessage(prompt));

    // Build system prompt using agent's full builder (includes instruction files + tool descriptions)
    const mcpTools = await this.agentImpl.ensureMCPConnected();
    const userTools = this.config.tools ?? [];
    const allTools = mcpTools.length > 0 ? [...userTools, ...mcpTools] : userTools;

    const systemPrompt = await this.agentImpl.buildSystemPromptForSession(
      allTools,
      this.sessionOptions?.systemPrompt,
      this.config.appendSystemPrompt
    );

    const sideChannel = new AsyncQueue<AgentEvent>();

    const loopConfig = this.agentImpl.buildLoopConfig({
      tools: allTools,
      systemPrompt,
      signal: this.abortController.signal,
      cwd: this.currentCwd,
      sessionId: this.id,
      compactThreshold: this.sessionOptions?.compactThreshold,
      emitEvent: (event) => {
        sideChannel.push(event);
      },
      sessionState: this.sessionState,
      readFileState: this.readFileState,
      onCwdChange: (newCwd) => {
        this.currentCwd = newCwd;
      },
    });

    const self = this;
    const loopWithCleanup = async function* () {
      try {
        yield* agentLoop(self.messages, loopConfig);
      } finally {
        sideChannel.close();
      }
    };

    try {
      for await (const event of merge([loopWithCleanup(), sideChannel])) {
        if (event.type === 'usage') {
          this.cumulativeUsage = event.usage;
        }
        this.config.onEvent?.(event);
        yield event;
      }
    } finally {
      // Persist session regardless of success or failure — this ensures that
      // partial transcripts, user messages, and accumulated usage are never lost.
      if (this.config.sessionStore) {
        try {
          // Serialize background task state so it survives session restore
          const bgManager = this.sessionState[BG_MANAGER_KEY];
          const bgTaskStates =
            bgManager instanceof BackgroundTaskManager ? bgManager.toSerializable() : undefined;

          // Serialize readFileState for read-before-write safety across session restores
          const readFileEntries = Array.from(this.readFileState.entries()).map(
            ([path, entry]) => [path, { ...entry }] as const
          );

          await this.config.sessionStore.save(this.id, {
            id: this.id,
            messages: this.messages,
            usage: this.cumulativeUsage,
            metadata: {
              sessionState: this.sessionState,
              lastCwd: this.currentCwd,
              backgroundTasks: bgTaskStates,
              readFileState: readFileEntries.length > 0 ? readFileEntries : undefined,
            },
            createdAt: this.createdAt,
            updatedAt: Date.now(),
          });
        } catch (err) {
          // Session persistence failure is non-fatal but should be observable
          this.config.onEvent?.({
            type: 'error',
            error: new Error(
              `Session persistence failed: ${err instanceof Error ? err.message : String(err)}`
            ),
          });
        }
      }
    }
  }

  getMessages(): ProviderMessage[] {
    return [...this.messages];
  }

  getUsage(): Usage {
    return { ...this.cumulativeUsage };
  }

  getContextTokenCount(): number {
    return estimateMessagesTokenCount(this.messages);
  }

  async compact(): Promise<string> {
    if (this.messages.length <= 2) {
      return 'Nothing to compact';
    }

    // First try micro-compact
    const { messages: microCompacted, freedTokens } = microCompact(this.messages);
    if (freedTokens > 0) {
      this.messages = microCompacted;
    }

    // Then do full compaction via API
    try {
      const { messages: compacted, summary } = await compactMessages(this.messages, {
        provider: this.config.provider,
        model: this.config.model,
        maxTokens: this.config.contextWindow
          ? Math.floor(this.config.contextWindow * 0.5)
          : 100_000,
      });
      this.messages = compacted;

      // Clear readFileState after compaction since old entries may reference removed messages
      this.readFileState.clear();

      return summary || `Compacted to ${this.messages.length} messages`;
    } catch {
      return freedTokens > 0
        ? `Micro-compacted: freed ~${freedTokens} tokens`
        : 'Compaction failed';
    }
  }

  abort(): void {
    this.abortController.abort();
    this.abortController = new AbortController();
  }

  async close(): Promise<void> {
    this.abort();
    this.messages = [];
  }
}
