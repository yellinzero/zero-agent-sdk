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
// Providers
// ---------------------------------------------------------------------------

// Alibaba (Qwen)
export type { AlibabaProviderConfig } from './providers/alibaba/index.js';
export {
  ALIBABA_MODELS,
  AlibabaProvider,
  alibaba,
  createAlibabaProvider,
  getAlibabaModelInfo,
} from './providers/alibaba/index.js';
// Amazon Bedrock
export type { BedrockProviderConfig } from './providers/amazon-bedrock/index.js';
export {
  BEDROCK_MODELS,
  BedrockProvider,
  bedrock,
  createBedrockProvider,
  getBedrockModelInfo,
} from './providers/amazon-bedrock/index.js';
// Anthropic
export {
  AnthropicProvider,
  anthropic,
  createAnthropicProvider,
} from './providers/anthropic/index.js';
// Azure OpenAI
export type { AzureOpenAIProviderConfig } from './providers/azure/index.js';
export {
  AZURE_MODELS,
  AzureOpenAIProvider,
  azure,
  createAzureOpenAIProvider,
  getAzureModelInfo,
} from './providers/azure/index.js';
// Baseten
export type { BasetenProviderConfig } from './providers/baseten/index.js';
export {
  BASETEN_MODELS,
  BasetenProvider,
  baseten,
  createBasetenProvider,
  getBasetenModelInfo,
} from './providers/baseten/index.js';
// Cerebras
export type { CerebrasProviderConfig } from './providers/cerebras/index.js';
export {
  CEREBRAS_MODELS,
  CerebrasProvider,
  cerebras,
  createCerebrasProvider,
  getCerebrasModelInfo,
} from './providers/cerebras/index.js';
// Cohere
export type { CohereProviderConfig } from './providers/cohere/index.js';
export {
  COHERE_MODELS,
  CohereProvider,
  cohere,
  createCohereProvider,
  getCohereModelInfo,
} from './providers/cohere/index.js';
// DeepInfra
export type { DeepInfraProviderConfig } from './providers/deepinfra/index.js';
export {
  createDeepInfraProvider,
  DEEPINFRA_MODELS,
  DeepInfraProvider,
  deepinfra,
  getDeepInfraModelInfo,
} from './providers/deepinfra/index.js';
// DeepSeek
export type { DeepSeekProviderConfig } from './providers/deepseek/index.js';
export {
  createDeepSeekProvider,
  DEEPSEEK_MODELS,
  DeepSeekProvider,
  deepseek,
  getDeepSeekModelInfo,
} from './providers/deepseek/index.js';
// Fireworks AI
export type { FireworksProviderConfig } from './providers/fireworks/index.js';
export {
  createFireworksProvider,
  FIREWORKS_MODELS,
  FireworksProvider,
  fireworks,
  getFireworksModelInfo,
} from './providers/fireworks/index.js';
// Google Gemini
export type { GoogleProviderConfig } from './providers/google/index.js';
export {
  createGoogleProvider,
  GOOGLE_MODELS,
  GoogleProvider,
  getGoogleModelInfo,
  google,
} from './providers/google/index.js';
// Google Vertex AI
export type { VertexAIProviderConfig } from './providers/google-vertex/index.js';
export {
  createVertexAIProvider,
  getVertexModelInfo,
  googleVertex,
  VERTEX_MODELS,
  VertexAIProvider,
} from './providers/google-vertex/index.js';
// Groq
export type { GroqProviderConfig } from './providers/groq/index.js';
export {
  createGroqProvider,
  GROQ_MODELS,
  GroqProvider,
  getGroqModelInfo,
  groq,
} from './providers/groq/index.js';
// Hugging Face
export type { HuggingFaceProviderConfig } from './providers/huggingface/index.js';
export {
  createHuggingFaceProvider,
  getHuggingFaceModelInfo,
  HUGGINGFACE_MODELS,
  HuggingFaceProvider,
  huggingface,
} from './providers/huggingface/index.js';
// Mistral
export type { MistralProviderConfig } from './providers/mistral/index.js';
export {
  createMistralProvider,
  getMistralModelInfo,
  MISTRAL_MODELS,
  MistralProvider,
  mistral,
} from './providers/mistral/index.js';
// Moonshot AI
export type { MoonshotAIProviderConfig } from './providers/moonshotai/index.js';
export {
  createMoonshotAIProvider,
  getMoonshotAIModelInfo,
  MOONSHOTAI_MODELS,
  MoonshotAIProvider,
  moonshotai,
} from './providers/moonshotai/index.js';
// Open Responses
export type { OpenResponsesProviderConfig } from './providers/open-responses/index.js';
export {
  createOpenResponses,
  OPEN_RESPONSES_DEFAULT_MODEL_INFO,
  OpenResponsesProvider,
  openResponses,
} from './providers/open-responses/index.js';
// OpenAI
export type { OpenAIProviderConfig } from './providers/openai/index.js';
export {
  createOpenAIProvider,
  getOpenAIModelInfo,
  OPENAI_MODELS,
  OpenAIProvider,
  openai,
} from './providers/openai/index.js';
// OpenAI-Compatible base
export type {
  GenericOpenAICompatibleConfig,
  OpenAICompatibleConfig,
} from './providers/openai-compatible/index.js';
export {
  createOpenAICompatible,
  GenericOpenAICompatibleProvider,
  OpenAICompatibleProvider,
} from './providers/openai-compatible/index.js';
// Perplexity
export type { PerplexityProviderConfig } from './providers/perplexity/index.js';
export {
  createPerplexityProvider,
  getPerplexityModelInfo,
  PERPLEXITY_MODELS,
  PerplexityProvider,
  perplexity,
} from './providers/perplexity/index.js';
export { defaultRegistry, ProviderRegistry } from './providers/registry.js';
// Together AI
export type { TogetherAIProviderConfig } from './providers/togetherai/index.js';
export {
  createTogetherAIProvider,
  getTogetherAIModelInfo,
  TOGETHERAI_MODELS,
  TogetherAIProvider,
  togetherai,
} from './providers/togetherai/index.js';
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
// xAI (Grok)
export type { XAIProviderConfig } from './providers/xai/index.js';
export {
  createXAIProvider,
  getXAIModelInfo,
  XAI_MODELS,
  XAIProvider,
  xai,
} from './providers/xai/index.js';

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
// OpenAI Embeddings
// ---------------------------------------------------------------------------

export type { OpenAIEmbeddingConfig } from './providers/openai/embedding.js';
export { createOpenAIEmbedding, OpenAIEmbeddingModel } from './providers/openai/embedding.js';

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
// Image Providers
// ---------------------------------------------------------------------------

export {
  BFL_IMAGE_MODELS,
  BlackForestLabsImageModel,
  createBlackForestLabs,
} from './providers/black-forest-labs/index.js';
export { createFal, FAL_IMAGE_MODELS, FalImageModel } from './providers/fal/index.js';
export { createLuma, LUMA_IMAGE_MODELS, LumaImageModel } from './providers/luma/index.js';
export { createProdia, PRODIA_IMAGE_MODELS, ProdiaImageModel } from './providers/prodia/index.js';
export {
  createReplicate,
  REPLICATE_IMAGE_MODELS,
  ReplicateImageModel,
} from './providers/replicate/index.js';

// ---------------------------------------------------------------------------
// Video Providers
// ---------------------------------------------------------------------------

export {
  BYTEDANCE_MODELS,
  ByteDanceVideoModel,
  createByteDance,
} from './providers/bytedance/index.js';
export {
  createKlingAI,
  KLINGAI_MODELS,
  KlingAIVideoModel,
} from './providers/klingai/index.js';

// ---------------------------------------------------------------------------
// Audio Providers
// ---------------------------------------------------------------------------

export {
  ASSEMBLYAI_MODELS,
  AssemblyAITranscriptionModel,
  createAssemblyAI,
} from './providers/assemblyai/index.js';
export {
  createDeepgram,
  DEEPGRAM_MODELS,
  DeepgramSpeechModel,
  DeepgramTranscriptionModel,
} from './providers/deepgram/index.js';
export {
  createElevenLabs,
  ELEVENLABS_MODELS,
  ElevenLabsSpeechModel,
  ElevenLabsTranscriptionModel,
} from './providers/elevenlabs/index.js';
export { createGladia, GLADIA_MODELS, GladiaTranscriptionModel } from './providers/gladia/index.js';
export { createHume, HUME_MODELS, HumeSpeechModel } from './providers/hume/index.js';
export { createLMNT, LMNT_MODELS, LMNTSpeechModel } from './providers/lmnt/index.js';
export { createRevAI, REVAI_MODELS, RevAITranscriptionModel } from './providers/revai/index.js';
