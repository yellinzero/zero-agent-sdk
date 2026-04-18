/**
 * AgentImpl — the concrete implementation of the Agent interface.
 * Orchestrates the agent loop, session management, event streaming,
 * MCP auto-connect, structured output, and appendSystemPrompt.
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
  OutputStreamEvent,
  RunOptions,
  StreamOutputResult,
  StructuredAgentResult,
  StructuredOutputMode,
} from '../core/agent.js';
import { AgentError, StructuredOutputError } from '../core/errors.js';
import type { AgentEvent } from '../core/events.js';
import type {
  InferOutputElement,
  InferOutputPartial,
  InferOutputResult,
  OutputDefinition,
} from '../core/output.js';
import type { AgentSession, SessionOptions } from '../core/session.js';
import type { Usage } from '../core/types.js';
import { MCPClient } from '../mcp/client.js';
import { normalizeServerName } from '../mcp/normalization.js';
import type { MCPConnection } from '../mcp/types.js';
import {
  getSupportedResponseFormats,
  type ProviderContentBlock,
  type ProviderMessage,
  resolveResponseFormatStrategy,
  type ToolChoice,
} from '../providers/types.js';
import {
  BackgroundTaskManager,
  BG_MANAGER_KEY,
  type SerializableTaskState,
} from '../tools/builtin/background-task.js';
import { isSyntheticStructuredOutputTool } from '../tools/structured-output.js';
import type { AgentSessionState, SDKTool } from '../tools/types.js';
import { createLinkedAbortController } from '../utils/abort.js';
import { AsyncQueue } from '../utils/async-queue.js';
import { createUserMessage } from '../utils/messages.js';
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
    this.validateToolChoiceConfig();
  }

  /**
   * Fail-fast validation for `toolChoice` against provider capabilities.
   * Run once at construction so callers see misconfigurations immediately.
   * Output / responseFormat compatibility is checked lazily per-run, since
   * `output` is a per-run option.
   */
  private validateToolChoiceConfig(toolChoice?: ToolChoice): void {
    const choice = toolChoice ?? this.config.toolChoice;
    if (!choice) return;
    const info = this.config.provider.getModelInfo(this.config.model);
    if (info.supportsToolChoice === false) {
      throw new AgentError(
        `Provider '${this.config.provider.providerId}' / model '${this.config.model}' does not support toolChoice. ` +
          `Remove the toolChoice option or switch to a provider that honors it.`,
        'INVALID_CONFIG'
      );
    }
  }

  /**
   * Validate that a structured `output` definition is compatible with the
   * provider/model. Performed once per call site so misconfigurations surface
   * before the loop starts streaming. `runToolChoice` is the per-run override
   * (if any); the effective toolChoice (run override ?? agent config) must not
   * conflict with tool-synthesis structured output.
   */
  private validateOutputConfig(
    output: OutputDefinition<any, any, any>,
    runToolChoice?: ToolChoice,
    modelId?: string,
    structuredOutputMode?: StructuredOutputMode
  ): void {
    const provider = this.config.provider;
    const targetModel = modelId ?? this.config.model;
    const info = provider.getModelInfo(targetModel);
    const responseFormat = output.responseFormat;
    if (responseFormat.type === 'text') return;

    const supported = getSupportedResponseFormats(info);
    const strategy = resolveResponseFormatStrategy(info);
    const effectiveToolChoice = runToolChoice ?? this.config.toolChoice;
    const mode = structuredOutputMode ?? this.config.structuredOutputMode ?? 'strict';

    // Tool-synthesis providers handle any output kind by injecting a synthetic
    // tool — they don't need native responseFormat support.
    if (
      strategy === 'tool-synthesis' ||
      (!supported.includes(responseFormat.type) && info.supportsToolUse)
    ) {
      if (effectiveToolChoice && mode === 'strict') {
        throw new AgentError(
          `Provider '${provider.providerId}' emulates structured output via an internal tool, ` +
            `which reserves toolChoice. Remove the toolChoice option for this run.`,
          'INVALID_CONFIG'
        );
      }
      return;
    }

    if (!supported.includes(responseFormat.type)) {
      throw new AgentError(
        `Provider '${provider.providerId}' / model '${targetModel}' does not support ` +
          `responseFormat type '${responseFormat.type}' (Output.${output.kind}). ` +
          `Supported: ${supported.length ? supported.join(', ') : 'none'}.`,
        'INVALID_CONFIG'
      );
    }
  }

  /**
   * Build a complete AgentLoopConfig from the agent's config and per-call overrides.
   */
  buildLoopConfig(overrides: {
    tools: SDKTool[];
    systemPrompt: string;
    signal: AbortSignal;
    emitEvent: (event: AgentEvent) => void;
    maxTurns?: number;
    toolChoice?: ToolChoice;
    structuredOutputMode?: StructuredOutputMode;
    output?: OutputDefinition<any, any, any>;
    cwd?: string;
    sessionId?: string;
    compactThreshold?: number;
    sessionState?: AgentSessionState;
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
      toolChoice: overrides.toolChoice ?? this.config.toolChoice,
      structuredOutputMode:
        overrides.structuredOutputMode ?? this.config.structuredOutputMode ?? 'strict',
      output: overrides.output,
      maxStructuredOutputRepairs: this.config.maxStructuredOutputRepairs,
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

  // -------------------------------------------------------------------------
  // run() — overloaded
  // -------------------------------------------------------------------------

  run(prompt: string, options?: RunOptions): Promise<AgentResult>;
  run<TOutput extends OutputDefinition<any, any, any>>(
    prompt: string,
    options: RunOptions & { output: TOutput }
  ): Promise<StructuredAgentResult<InferOutputResult<TOutput>>>;
  async run(
    prompt: string,
    options?: RunOptions & { output?: OutputDefinition<any, any, any> }
  ): Promise<AgentResult | StructuredAgentResult<unknown>> {
    if (options?.output) {
      return this.runStructured(
        prompt,
        options as RunOptions & { output: OutputDefinition<any, any, any> }
      );
    }
    return this.runText(prompt, options);
  }

  private async runText(prompt: string, options?: RunOptions): Promise<AgentResult> {
    const collectedErrors: Array<{ type: string; message: string; turnNumber?: number }> = [];
    let finalUsage = emptyUsage();
    let turns = 0;
    let finalStopReason = 'end_turn';
    let currentTurn = 0;
    let lastTurnTexts: string[] = [];
    let lastTurnThinking: AgentResultContent[] = [];
    let finalAssistantMessage: ProviderMessage | undefined;
    const messages: ProviderMessage[] = [createUserMessage(prompt)];

    for await (const event of this.runLoop(messages, options)) {
      this.config.onEvent?.(event);

      if (event.type === 'turn_start') {
        currentTurn = event.turnNumber;
        lastTurnTexts = [];
        lastTurnThinking = [];
      }
      if (event.type === 'text') lastTurnTexts.push(event.text);
      if (event.type === 'thinking') {
        lastTurnThinking.push({ type: 'thinking', thinking: event.thinking });
      }
      if (event.type === 'usage') finalUsage = event.usage;
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
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]?.role === 'assistant') {
            finalAssistantMessage = messages[i];
            break;
          }
        }
      }
    }

    const text = lastTurnTexts.join('');
    const content: AgentResultContent[] = [...lastTurnThinking];
    if (text) content.push({ type: 'text', text });

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

  private async runStructured(
    prompt: string,
    options: RunOptions & { output: OutputDefinition<any, any, any> }
  ): Promise<StructuredAgentResult<unknown>> {
    this.validateOutputConfig(
      options.output,
      options.toolChoice,
      undefined,
      options.structuredOutputMode
    );
    const stream = this.streamStructuredInternal(prompt, options);

    // Drain agent events into onEvent callback (best-effort) and collect a
    // text-mode-equivalent transcript for the final result.
    const collectedErrors: Array<{ type: string; message: string; turnNumber?: number }> = [];
    let turns = 0;
    let finalStopReason = 'end_turn';
    let currentTurn = 0;
    let finalAssistantMessage: ProviderMessage | undefined;
    let lastTurnTexts: string[] = [];
    let lastTurnThinking: AgentResultContent[] = [];

    const drainEvents = (async () => {
      for await (const event of stream.events) {
        this.config.onEvent?.(event);
        if (event.type === 'turn_start') {
          currentTurn = event.turnNumber;
          lastTurnTexts = [];
          lastTurnThinking = [];
        }
        if (event.type === 'text') lastTurnTexts.push(event.text);
        if (event.type === 'thinking') {
          lastTurnThinking.push({ type: 'thinking', thinking: event.thinking });
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
        }
      }
    })();

    let output: unknown;
    let finalUsage: Usage = emptyUsage();
    try {
      [output, finalUsage] = await Promise.all([stream.output, stream.usage]);
    } finally {
      await drainEvents;
    }

    // Recover finalAssistantMessage from the final messages array via events
    // is awkward, so reach into the messages buffer instead.
    const messagesBuf = stream.messages;
    for (let i = messagesBuf.length - 1; i >= 0; i--) {
      if (messagesBuf[i]?.role === 'assistant') {
        finalAssistantMessage = messagesBuf[i];
        break;
      }
    }

    const text = await stream.text;
    const content: AgentResultContent[] = [...lastTurnThinking];
    if (text) content.push({ type: 'text', text });

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
      messages: convertProviderMessages(messagesBuf),
      errors: collectedErrors.length > 0 ? collectedErrors : undefined,
      output,
    };
  }

  // -------------------------------------------------------------------------
  // stream() — overloaded
  // -------------------------------------------------------------------------

  stream(prompt: string, options?: RunOptions): AsyncGenerator<AgentEvent>;
  stream<TOutput extends OutputDefinition<any, any, any>>(
    prompt: string,
    options: RunOptions & { output: TOutput }
  ): StreamOutputResult<
    InferOutputPartial<TOutput>,
    InferOutputResult<TOutput>,
    InferOutputElement<TOutput>
  >;
  stream(
    prompt: string,
    options?: RunOptions & { output?: OutputDefinition<any, any, any> }
  ): AsyncGenerator<AgentEvent> | StreamOutputResult<unknown, unknown, unknown> {
    if (options?.output) {
      return this.streamStructuredInternal(
        prompt,
        options as RunOptions & {
          output: OutputDefinition<any, any, any>;
        }
      );
    }
    return this.streamEvents(prompt, options);
  }

  private async *streamEvents(prompt: string, options?: RunOptions): AsyncGenerator<AgentEvent> {
    const messages: ProviderMessage[] = [createUserMessage(prompt)];
    for await (const event of this.runLoop(messages, options)) {
      this.config.onEvent?.(event);
      yield event;
    }
  }

  private streamStructuredInternal(
    prompt: string,
    options: RunOptions & { output: OutputDefinition<any, any, any> }
  ): StreamOutputResult<unknown, unknown, unknown> & { messages: ProviderMessage[] } {
    this.validateOutputConfig(
      options.output,
      options.toolChoice,
      undefined,
      options.structuredOutputMode
    );
    const output = options.output;

    const messages: ProviderMessage[] = [createUserMessage(prompt)];
    const eventsQueue = new AsyncQueue<AgentEvent>();
    const textQueue = new AsyncQueue<string>();
    const partialQueue = new AsyncQueue<unknown>();
    const elementQueue = new AsyncQueue<unknown>();
    const fullQueue = new AsyncQueue<OutputStreamEvent<unknown, unknown>>();

    let resolveOutput!: (value: unknown) => void;
    let rejectOutput!: (error: Error) => void;
    const outputPromise = new Promise<unknown>((resolve, reject) => {
      resolveOutput = resolve;
      rejectOutput = reject;
    });
    // Suppress unhandled-rejection if the consumer iterates only the streams
    // and never awaits `output`. Real consumers awaiting `output` still see
    // the rejection because `.catch` returns a new promise.
    outputPromise.catch(() => {});
    let resolveText!: (value: string) => void;
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    let resolveUsage!: (value: Usage) => void;
    const usagePromise = new Promise<Usage>((resolve) => {
      resolveUsage = resolve;
    });

    let accumulatedText = '';
    let accumulatedJson = '';
    let lastPartialSnapshot: string | undefined;
    let lastElementCount = 0;
    let syntheticToolResult: unknown;
    let syntheticToolCaptured = false;
    let finalUsage: Usage = emptyUsage();
    let finishReason: string | undefined;

    const resetTurnAccumulators = () => {
      accumulatedText = '';
      accumulatedJson = '';
      lastPartialSnapshot = undefined;
      lastElementCount = 0;
      syntheticToolResult = undefined;
      syntheticToolCaptured = false;
      finishReason = undefined;
    };

    const emitPartialFromText = (source: string) => {
      try {
        const parsed = output.parsePartial(source);
        if (parsed.partial !== undefined) {
          const snapshot = stableStringify(parsed.partial);
          if (snapshot !== lastPartialSnapshot) {
            lastPartialSnapshot = snapshot;
            partialQueue.push(parsed.partial);
            fullQueue.push({ type: 'object', object: parsed.partial });
          }
        }
        if (parsed.elements && parsed.elements.length > lastElementCount) {
          for (let i = lastElementCount; i < parsed.elements.length; i++) {
            const element = parsed.elements[i];
            elementQueue.push(element);
            fullQueue.push({ type: 'element', element });
          }
          lastElementCount = parsed.elements.length;
        }
      } catch {
        // partial parse errors are non-fatal during streaming
      }
    };

    const drive = (async () => {
      try {
        for await (const event of this.runLoop(messages, options)) {
          this.config.onEvent?.(event);
          eventsQueue.push(event);

          if (event.type === 'turn_start') {
            resetTurnAccumulators();
          } else if (event.type === 'text') {
            accumulatedText += event.text;
            textQueue.push(event.text);
            fullQueue.push({ type: 'text-delta', textDelta: event.text });
            emitPartialFromText(accumulatedText);
          } else if (
            event.type === 'tool_use_delta' &&
            isSyntheticStructuredOutputTool(event.toolName)
          ) {
            accumulatedJson = event.accumulatedJson;
            textQueue.push(event.partialJson);
            fullQueue.push({ type: 'text-delta', textDelta: event.partialJson });
            emitPartialFromText(accumulatedJson);
          } else if (
            event.type === 'tool_use_end' &&
            isSyntheticStructuredOutputTool(event.toolName) &&
            !event.isError
          ) {
            syntheticToolResult = event.result;
            syntheticToolCaptured = true;
          } else if (event.type === 'usage') {
            finalUsage = event.usage;
          } else if (event.type === 'turn_end') {
            finishReason = event.stopReason;
            finalUsage = event.usage;
          }
        }

        // Resolve the final structured value. Tool-synthesis path: use the
        // captured tool result (already validated by OutputDefinition.validate).
        // Native path: parseFinal on accumulated text.
        let finalValue: unknown;
        if (syntheticToolCaptured) {
          finalValue = syntheticToolResult;
          // Surface the canonical text representation for downstream consumers.
          resolveText(JSON.stringify(syntheticToolResult));
        } else {
          if (!accumulatedText.trim()) {
            throw new StructuredOutputError(
              'Model returned no text — cannot parse structured output.',
              'no_output',
              {
                kind: output.kind,
                finishReason,
                usage: finalUsage,
              }
            );
          }
          try {
            finalValue = output.parseFinal(accumulatedText, { finishReason });
          } catch (cause) {
            const isJsonError = cause instanceof SyntaxError;
            throw new StructuredOutputError(
              `Failed to parse structured output: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
              isJsonError ? 'parse_failed' : 'schema_mismatch',
              {
                kind: output.kind,
                rawText: accumulatedText,
                finishReason,
                usage: finalUsage,
              },
              cause instanceof Error ? cause : undefined
            );
          }
          resolveText(accumulatedText);
        }

        if (
          output.kind === 'array' &&
          Array.isArray(finalValue) &&
          finalValue.length > lastElementCount
        ) {
          for (let i = lastElementCount; i < finalValue.length; i++) {
            const element = finalValue[i];
            elementQueue.push(element);
            fullQueue.push({ type: 'element', element });
          }
          lastElementCount = finalValue.length;
        }

        fullQueue.push({ type: 'finish' });
        resolveOutput(finalValue);
      } catch (cause) {
        const error =
          cause instanceof Error
            ? cause
            : new StructuredOutputError(String(cause), 'parse_failed', {
                kind: output.kind,
                rawText: accumulatedText || accumulatedJson,
                finishReason,
                usage: finalUsage,
              });
        fullQueue.push({ type: 'error', error });
        rejectOutput(error);
        // Resolve text/usage so consumers awaiting them don't hang.
        resolveText(accumulatedText || accumulatedJson || '');
        partialQueue.fail(error);
        elementQueue.fail(error);
        fullQueue.fail(error);
      } finally {
        resolveUsage(finalUsage);
        eventsQueue.close();
        textQueue.close();
        partialQueue.close();
        elementQueue.close();
        fullQueue.close();
      }
    })();

    // Surface unhandled rejections from the drive() promise so node doesn't
    // log them when the consumer awaits `output` later.
    drive.catch(() => {});

    return {
      events: eventsQueue,
      textStream: textQueue,
      partialOutputStream: partialQueue,
      elementStream: elementQueue,
      fullStream: fullQueue,
      output: outputPromise,
      text: textPromise,
      usage: usagePromise,
      messages,
    };
  }

  // -------------------------------------------------------------------------
  // System prompt + MCP wiring
  // -------------------------------------------------------------------------

  private async buildSystemPromptAsync(
    tools: SDKTool[],
    override?: string,
    appendOverride?: string
  ): Promise<string> {
    const explicitBase = override ?? this.config.systemPrompt;
    const append = appendOverride ?? this.config.appendSystemPrompt ?? '';

    if (explicitBase !== undefined) {
      return append ? `${explicitBase}\n\n${append}` : explicitBase;
    }

    const cwd = this.config.cwd ?? process.cwd();
    let instructionContent: string | undefined;

    if (this.config.loadInstructionFiles) {
      try {
        instructionContent = (await loadInstructionFiles({ projectRoot: cwd })) || undefined;
      } catch {
        // non-fatal
      }
    }

    let memoryContent: string | undefined;
    if (this.config.memoryDir) {
      try {
        memoryContent = (await loadMemoryFiles(this.config.memoryDir)) || undefined;
      } catch {
        // non-fatal
      }
    }

    let builtPrompt = await buildSystemPromptFromConfig({
      tools,
      instructionContent,
      memoryContent,
    });

    if (append) builtPrompt = `${builtPrompt}\n\n${append}`;
    return builtPrompt;
  }

  private async connectMCPServers(): Promise<SDKTool[]> {
    if (!this.config.mcpServers?.length) return this.mcpTools;

    if (!this.mcpClient) this.mcpClient = new MCPClient();

    const connections: MCPConnection[] = this.mcpClient.getConnections?.() ?? [];
    const connectedNames = new Set(
      connections.filter((c) => c.status === 'connected').map((c) => c.name)
    );

    const serversToConnect = this.config.mcpServers.filter((sc) => {
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
    options?: RunOptions & { output?: OutputDefinition<any, any, any> }
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

      const mcpTools = await this.connectMCPServers();
      const userTools = options?.tools ?? this.config.tools ?? [];
      const allTools = mcpTools.length > 0 ? [...userTools, ...mcpTools] : userTools;
      this.validateToolChoiceConfig(options?.toolChoice);

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
        toolChoice: options?.toolChoice,
        structuredOutputMode: options?.structuredOutputMode,
        output: options?.output,
        emitEvent: (event) => sideChannel.push(event),
      });

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

  getMCPTools(): SDKTool[] {
    return this.mcpTools;
  }

  ensureMCPConnected(): Promise<SDKTool[]> {
    return this.connectMCPServers();
  }

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
 * Stable JSON stringify used for partial-output dedup. Sorts object keys so
 * the same logical value always produces the same string regardless of insert
 * order — prevents spurious partial emissions on key reordering.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function convertSingleBlock(b: ProviderContentBlock): AgentResultContent {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
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

  private sessionState: AgentSessionState = {};
  private readFileState = new Map<string, import('../tools/types.js').ReadFileStateEntry>();
  private currentCwd: string;

  private sendLock: Promise<void> = Promise.resolve();

  constructor(config: AgentConfig, agentImpl: AgentImpl, options?: SessionOptions) {
    this.id = options?.id ?? options?.resumeId ?? randomUUID();
    this.config = config;
    this.agentImpl = agentImpl;
    this.sessionOptions = options;
    this.createdAt = Date.now();
    this.currentCwd = config.cwd ?? process.cwd();

    if (options?.initialMessages) this.messages = [...options.initialMessages];
  }

  static async fromStore(
    config: AgentConfig,
    agentImpl: AgentImpl,
    resumeId: string,
    store: import('../core/store.js').SessionStore,
    options?: SessionOptions
  ): Promise<AgentSessionImpl> {
    const data = await store.load(resumeId);
    const session = new AgentSessionImpl(config, agentImpl, { ...options, id: resumeId });

    if (data) {
      session.messages = data.messages;
      session.cumulativeUsage = data.usage;
      session.createdAt = data.createdAt;
      if (data.metadata?.sessionState) {
        session.sessionState = data.metadata.sessionState as AgentSessionState;
      }
      if (data.metadata?.lastCwd && typeof data.metadata.lastCwd === 'string') {
        session.currentCwd = data.metadata.lastCwd;
      }
      if (data.metadata?.backgroundTasks && Array.isArray(data.metadata.backgroundTasks)) {
        const bgManager = BackgroundTaskManager.fromSerializable(
          data.metadata.backgroundTasks as SerializableTaskState[]
        );
        session.sessionState[BG_MANAGER_KEY] = bgManager;
      }
      if (data.metadata?.readFileState && Array.isArray(data.metadata.readFileState)) {
        for (const [path, entry] of data.metadata.readFileState as Array<[string, any]>) {
          if (typeof path === 'string' && entry) session.readFileState.set(path, entry);
        }
      }
    }

    return session;
  }

  async *send(prompt: string): AsyncGenerator<AgentEvent> {
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
      emitEvent: (event) => sideChannel.push(event),
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
        if (event.type === 'usage') this.cumulativeUsage = event.usage;
        this.config.onEvent?.(event);
        yield event;
      }
    } finally {
      if (this.config.sessionStore) {
        try {
          const bgManager = this.sessionState[BG_MANAGER_KEY];
          const bgTaskStates =
            bgManager instanceof BackgroundTaskManager ? bgManager.toSerializable() : undefined;

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
    if (this.messages.length <= 2) return 'Nothing to compact';

    const { messages: microCompacted, freedTokens } = microCompact(this.messages);
    if (freedTokens > 0) this.messages = microCompacted;

    try {
      const { messages: compacted, summary } = await compactMessages(this.messages, {
        provider: this.config.provider,
        model: this.config.model,
        maxTokens: this.config.contextWindow
          ? Math.floor(this.config.contextWindow * 0.5)
          : 100_000,
      });
      this.messages = compacted;
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

// addUsage retained for callers — silence unused-import warnings.
void addUsage;
