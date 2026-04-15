/**
 * zero-agent-sdk — Main entry point
 *
 * Provider-agnostic agent SDK with tool orchestration, MCP integration,
 * permissions, hooks, and context management.
 */

export type { AutoCompactConfig, CompactCircuitState, CompactOptions } from './context/compact.js';
// Context
export {
  autoCompactIfNeeded,
  compactMessages,
  createCompactCircuitState,
  microCompact,
  postCompactCleanup,
  recordCompactFailure,
  recordCompactSuccess,
  shouldCompact,
  stripMediaFromMessages,
} from './context/compact.js';
export type { InstructionFilesOptions } from './context/memory.js';
export { loadInstructionFiles, loadMemoryFiles } from './context/memory.js';
export type { SystemPromptConfig, SystemPromptSection } from './context/system-prompt.js';
export { buildSystemPrompt } from './context/system-prompt.js';
export type { CachedSystemPromptSection } from './context/system-prompt-cache.js';
export {
  clearSectionCache,
  invalidateSection,
  resolveSections,
  systemPromptSection,
  volatileSection,
} from './context/system-prompt-cache.js';
export type {
  Agent,
  AgentConfig,
  AgentResult,
  AgentResultContent,
  AgentResultMessage,
  RunOptions,
  UsageCallbackEvent,
} from './core/agent.js';
// Core
export { createAgent, createAgentAsync } from './core/agent.js';
export type { AgentErrorCode } from './core/errors.js';
export {
  AbortError,
  AgentError,
  BudgetExceededError,
  PermissionDeniedError,
  ProviderError,
  ToolExecutionError,
} from './core/errors.js';
export type {
  AgentEvent,
  CompactEvent,
  ErrorEvent,
  PermissionRequestEvent,
  TextEvent,
  ThinkingEvent,
  ToolUseDeltaEvent,
  ToolUseEndEvent,
  ToolUseStartEvent,
  TurnEndEvent,
  TurnStartEvent,
  UsageEvent,
} from './core/events.js';
export type { AgentSession, SessionOptions } from './core/session.js';
export type {
  ContentBlock,
  Logger,
  StopReason,
  TextBlock,
  ThinkingBlock,
  ThinkingConfig,
  ToolResultBlock,
  ToolUseBlock,
  Usage,
} from './core/types.js';
export type { HookChainResult } from './hooks/runner.js';
export {
  runCompactHook,
  runErrorHook,
  runHookChain,
  runPostQueryHook,
  runPostToolUseHook,
  runPreQueryHook,
  runPreToolUseHook,
  runTurnEndHook,
  runTurnStartHook,
} from './hooks/runner.js';
// Hooks
export type {
  CompactHookEvent,
  ErrorHookEvent,
  HookConfig,
  HookEventType,
  HookFn,
  HookFnOrArray,
  HookResult,
  HookTimeoutOptions,
  PostQueryEvent,
  PostToolUseEvent,
  PreQueryEvent,
  PreToolUseEvent,
  TurnEndHookEvent,
  TurnStartHookEvent,
} from './hooks/types.js';
export { HookError } from './hooks/types.js';
export { MCPClient } from './mcp/client.js';
export {
  decodeMCPToolName,
  encodeMCPToolName,
  isMCPTool,
} from './mcp/normalization.js';
export { mcpToolsToSDKTools } from './mcp/tool-bridge.js';
export type {
  MCPSDKCallResult,
  MCPSDKToolInfo,
  MCPSDKTransportConfig,
} from './mcp/transports.js';
export { MCPSDKClientAdapter } from './mcp/transports.js';
// MCP
export type {
  MCPConnection,
  MCPConnectionEvent,
  MCPConnectionStatus,
  MCPElicitationHandler,
  MCPElicitationRequest,
  MCPElicitationResponse,
  MCPHTTPConfig,
  MCPInProcessConfig,
  MCPInProcessServer,
  MCPServerConfig,
  MCPSSEConfig,
  MCPStdioConfig,
  MCPToolAnnotations,
  MCPToolDefinition,
  MCPToolResult,
  MCPWebSocketConfig,
} from './mcp/types.js';
export type { CheckToolPermissionOptions } from './permissions/checker.js';
export { checkToolPermission, getHandlerForMode } from './permissions/checker.js';
export type {
  PathValidationOptions,
  PathValidationResult,
} from './permissions/path-validation.js';
export { validateFilePath, validateFilePathAsync } from './permissions/path-validation.js';
export type {
  DenialLimits,
  DenialTrackingState,
  ParsedRule,
  PermissionRuleEngineConfig,
} from './permissions/rules.js';
export {
  evaluateRules,
  matchRule,
  parseRulePattern,
  recordAllow,
  recordDenial,
} from './permissions/rules.js';
export type {
  SSRFGuardOptions,
  SSRFValidationResult,
} from './permissions/ssrf-guard.js';
export { validateUrl } from './permissions/ssrf-guard.js';
// Permissions
export type {
  PermissionContext,
  PermissionDecision,
  PermissionHandler,
  PermissionMode,
  PermissionRule,
} from './permissions/types.js';
export {
  allowAllHandler,
  defaultHandler,
  readOnlyHandler,
  strictDenyAllHandler,
  strictHandler,
} from './permissions/types.js';

// ---------------------------------------------------------------------------
// Providers — type-only re-exports
//
// Runtime provider imports should use sub-path entries for tree-shaking:
//   import { anthropic } from 'zero-agent-sdk/providers/anthropic'
//   import { openai }    from 'zero-agent-sdk/providers/openai'
// ---------------------------------------------------------------------------

export type { AlibabaProviderConfig } from './providers/alibaba/index.js';
export type { BedrockProviderConfig } from './providers/amazon-bedrock/index.js';
export type { AzureOpenAIProviderConfig } from './providers/azure/index.js';
export type { BasetenProviderConfig } from './providers/baseten/index.js';
export type { CerebrasProviderConfig } from './providers/cerebras/index.js';
export type { CohereProviderConfig } from './providers/cohere/index.js';
export type { DeepInfraProviderConfig } from './providers/deepinfra/index.js';
export type { DeepSeekProviderConfig } from './providers/deepseek/index.js';
export type { FireworksProviderConfig } from './providers/fireworks/index.js';
export type { GoogleProviderConfig } from './providers/google/index.js';
export type { VertexAIProviderConfig } from './providers/google-vertex/index.js';
export type { GroqProviderConfig } from './providers/groq/index.js';
export type { HuggingFaceProviderConfig } from './providers/huggingface/index.js';
export type { MistralProviderConfig } from './providers/mistral/index.js';
export type { MoonshotAIProviderConfig } from './providers/moonshotai/index.js';
export type { OpenResponsesProviderConfig } from './providers/open-responses/index.js';
export type { OpenAIProviderConfig } from './providers/openai/index.js';
export type {
  GenericOpenAICompatibleConfig,
  OpenAICompatibleConfig,
} from './providers/openai-compatible/index.js';
export type { PerplexityProviderConfig } from './providers/perplexity/index.js';
// Provider registry (lightweight — no provider SDK dependencies)
export { defaultRegistry, ProviderRegistry } from './providers/registry.js';
export type { TogetherAIProviderConfig } from './providers/togetherai/index.js';
// Provider types
export type {
  GenerateMessageParams,
  ModelInfo,
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderToolSchema,
  ProviderUsage,
  StreamMessageParams,
} from './providers/types.js';
export type { XAIProviderConfig } from './providers/xai/index.js';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type {
  AgentToolOptions,
  BuiltinToolsOptions,
  ChildAgentResult,
  Task,
  TaskStore,
  WebFetchToolOptions,
  WebSearchResult,
  WebSearchToolOptions,
} from './tools/builtin/index.js';
export {
  builtinTools,
  createAgentTool,
  createAskUserTool,
  createBashTool,
  createFileEditTool,
  createFileReadTool,
  createFileWriteTool,
  createGlobTool,
  createGrepTool,
  createNotebookEditTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskOutputTool,
  createTaskStopTool,
  createTaskUpdateTool,
  createWebFetchTool,
  createWebSearchTool,
  InMemoryTaskStore,
} from './tools/builtin/index.js';
export { ToolRegistry } from './tools/registry.js';
export type {
  PermissionCheckResult,
  SDKTool,
  SDKToolDef,
  SDKToolResult,
  ToolExecutionContext,
  ToolInputJSONSchema,
  ToolProgressEvent,
  ToolProgressFn,
  ValidationResult,
} from './tools/types.js';
export { buildSDKTool, findToolByName, toolMatchesName } from './tools/types.js';
export {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  extractText,
  hasToolUse,
} from './utils/messages.js';
// Utilities
export {
  addUsage,
  emptyUsage,
  estimateMessagesTokenCount,
  estimateTokenCount,
} from './utils/tokens.js';

// ---------------------------------------------------------------------------
// Session Store
// ---------------------------------------------------------------------------

export type { SessionData, SessionStore } from './core/store.js';
export { FileSessionStore, InMemorySessionStore } from './core/store.js';

// ---------------------------------------------------------------------------
// Agent Delegation
// ---------------------------------------------------------------------------

export type { AgentDefinition, DelegateToolOptions } from './agent-tool/delegate.js';
export { delegateTool } from './agent-tool/delegate.js';

// ---------------------------------------------------------------------------
// Native MCP Transports (experimental — not yet wired into MCPClient)
// ---------------------------------------------------------------------------

export type {
  SSETransportOptions,
  WebSocketTransportOptions,
} from './mcp/native-transports.js';
export {
  parseSSEFrames,
  SSETransport,
  WebSocketTransport,
} from './mcp/native-transports.js';

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

export type { SpanInfo, TracerConfig, TraceSpan } from './tracing/tracer.js';
export { createTracer, Tracer } from './tracing/tracer.js';

// ---------------------------------------------------------------------------
// Multimodal Tool Bridge
// ---------------------------------------------------------------------------

export {
  imageGenerationTool,
  speechGenerationTool,
  transcriptionTool,
} from './tools/multimodal.js';

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export type { Document, RetrievalOptions, Retriever } from './retrieval/types.js';
export { retrieverTool } from './retrieval/types.js';

// ---------------------------------------------------------------------------
// OpenAI Embeddings — use sub-path: 'zero-agent-sdk/providers/openai'
// ---------------------------------------------------------------------------

export type { OpenAIEmbeddingConfig } from './providers/openai/embedding.js';

// ---------------------------------------------------------------------------
// Multimodal Interfaces
// ---------------------------------------------------------------------------

export type {
  EmbeddingModel,
  EmbeddingModelCallOptions,
  EmbeddingModelResult,
  FileData,
  FileWithType,
  ImageModel,
  ImageModelCallOptions,
  ImageModelResult,
  ModelWarning,
  ResponseMeta,
  SpeechModel,
  SpeechModelCallOptions,
  SpeechModelResult,
  TranscriptionModel,
  TranscriptionModelCallOptions,
  TranscriptionModelResult,
  TranscriptionSegment,
  VideoData,
  VideoModel,
  VideoModelCallOptions,
  VideoModelResult,
} from './providers/multimodal.js';

// ---------------------------------------------------------------------------
// Generation Functions
// ---------------------------------------------------------------------------

export type {
  EmbedManyOptions,
  EmbedManyResult,
  EmbedOptions,
  EmbedResult,
  GenerateImageOptions,
  GenerateImageResult,
  GenerateSpeechOptions,
  GenerateSpeechResult,
  GenerateVideoOptions,
  GenerateVideoResult,
  TranscribeOptions,
  TranscribeResult,
} from './generate.js';
export {
  embed,
  embedMany,
  generateImage,
  generateSpeech,
  generateVideo,
  transcribe,
} from './generate.js';

// ---------------------------------------------------------------------------
// Image Providers — use sub-path entries:
//   import { createBlackForestLabs } from 'zero-agent-sdk/providers/black-forest-labs'
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Video Providers — use sub-path entries:
//   import { createByteDance } from 'zero-agent-sdk/providers/bytedance'
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audio Providers — use sub-path entries:
//   import { createElevenLabs } from 'zero-agent-sdk/providers/elevenlabs'
// ---------------------------------------------------------------------------
