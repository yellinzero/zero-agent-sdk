/**
 * ModelProvider interface — the core abstraction for LLM providers.
 *
 * Each provider implementation conforms to this interface,
 * handling its own message format conversion and API specifics.
 */

export interface ModelProvider {
  /** Provider identifier, e.g. 'provider-name' */
  readonly providerId: string;

  /** Stream a message response from the model */
  streamMessage(params: StreamMessageParams): AsyncGenerator<ProviderStreamEvent>;

  /** Generate a complete message response (non-streaming) */
  generateMessage(params: GenerateMessageParams): Promise<ProviderResponse>;

  /** Get metadata about a specific model */
  getModelInfo(modelId: string): ModelInfo;
}

// ---------------------------------------------------------------------------
// Request Parameters
// ---------------------------------------------------------------------------

export interface StreamMessageParams {
  model: string;
  messages: ProviderMessage[];
  systemPrompt: string | SystemPromptBlock[];
  tools?: ProviderToolSchema[];
  /**
   * Constrain how the model uses the provided tools.
   * - `auto`: model decides whether to call a tool (default when omitted)
   * - `any`: model MUST call one of the tools, its pick
   * - `none`: model MUST NOT call any tool (provider will drop the tools array where no native equivalent exists, e.g. Anthropic)
   * - `tool`: model MUST call the named tool
   *
   * Support matrix:
   * - Anthropic: auto | any | none (drops tools) | tool
   * - OpenAI-compatible: auto | any (→ required) | none | tool (→ function)
   * - Providers without native support silently ignore this field.
   */
  toolChoice?: ToolChoice;
  /**
   * Constrain the format of the model's text output.
   * - `text`: plain text (default when omitted)
   * - `json_object`: output must be a syntactically valid JSON object (loose, no schema)
   * - `json_schema`: output must conform to the provided JSON schema
   *
   * Support matrix:
   * - OpenAI-compatible: all three types (json_schema requires recent SDK + model)
   * - Tool-use-only providers (e.g. Anthropic / Bedrock Converse): satisfied
   *   by the agent loop via an internal structured-output tool.
   * - Providers without support reject unsupported responseFormat types.
   */
  responseFormat?: ResponseFormat;
  thinkingConfig?: ProviderThinkingConfig;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export type GenerateMessageParams = StreamMessageParams;

export type ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      name: string;
      schema: Record<string, unknown>;
      description?: string;
      strict?: boolean;
    };

export interface ProviderThinkingConfig {
  type: 'enabled' | 'disabled';
  budgetTokens?: number;
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

export interface SystemPromptBlock {
  type: 'text';
  text: string;
  /** @deprecated Use providerMetadata.cacheControl instead */
  cacheControl?: { type: 'ephemeral' };
  /** Provider-specific metadata (e.g. Anthropic cache control) */
  providerMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider-agnostic message format
// ---------------------------------------------------------------------------

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: ProviderContentBlock[];
}

export type ProviderContentBlock =
  | ProviderTextBlock
  | ProviderToolUseBlock
  | ProviderToolResultBlock
  | ProviderThinkingBlock
  | ProviderRedactedThinkingBlock
  | ProviderImageBlock
  | ProviderDocumentBlock;

export interface ProviderTextBlock {
  type: 'text';
  text: string;
}

export interface ProviderToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ProviderToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ProviderContentBlock[];
  is_error?: boolean;
  /** @deprecated Use providerMetadata.cacheControl instead */
  cacheControl?: { type: 'ephemeral' };
  /** Provider-specific metadata (e.g. Anthropic cache control) */
  providerMetadata?: Record<string, unknown>;
}

export interface ProviderThinkingBlock {
  type: 'thinking';
  thinking: string;
  /** @deprecated Use providerMetadata.signature instead */
  signature?: string;
  /** Provider-specific metadata (e.g. Anthropic thinking signature) */
  providerMetadata?: Record<string, unknown>;
}

export interface ProviderRedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

export interface ProviderImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface ProviderDocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

// ---------------------------------------------------------------------------
// Tool Schema
// ---------------------------------------------------------------------------

export interface ProviderToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stream Events
// ---------------------------------------------------------------------------

export type ProviderStreamEvent =
  | ProviderMessageStartEvent
  | ProviderContentBlockStartEvent
  | ProviderContentBlockDeltaEvent
  | ProviderContentBlockStopEvent
  | ProviderMessageDeltaEvent
  | ProviderMessageStopEvent
  | ProviderErrorEvent;

export interface ProviderMessageStartEvent {
  type: 'message_start';
  messageId?: string;
  model?: string;
  usage?: ProviderUsage;
}

export interface ProviderContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  block: ProviderContentBlock;
}

export interface ProviderContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: ProviderDelta;
}

export type ProviderDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string };

export interface ProviderContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface ProviderMessageDeltaEvent {
  type: 'message_delta';
  stopReason?: string;
  usage?: ProviderUsage;
}

export interface ProviderMessageStopEvent {
  type: 'message_stop';
}

export interface ProviderErrorEvent {
  type: 'error';
  error: Error;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface ProviderResponse {
  id: string;
  model: string;
  content: ProviderContentBlock[];
  stopReason: string;
  usage: ProviderUsage;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// ---------------------------------------------------------------------------
// Model Info
// ---------------------------------------------------------------------------

export interface ModelInfo {
  contextWindow: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsToolUse: boolean;
  supportsImages: boolean;
  supportsPdfInput: boolean;
  inputTokenCostPer1M?: number;
  outputTokenCostPer1M?: number;
  /**
   * ResponseFormat types the provider/model can satisfy. Empty array = unsupported.
   * 'text' is always implicitly supported and may be omitted from this list.
   */
  supportsResponseFormat?: Array<'text' | 'json_object' | 'json_schema'>;
  /**
   * How the provider delivers `responseFormat` on the wire:
   * - 'native': mapped to a native parameter (e.g. OpenAI `response_format`, Gemini `responseSchema`).
   * - 'tool-synthesis': legacy provider-local emulation path. New implementations
   *   should prefer agent-loop synthesis so structured output can coexist with caller tools.
   * - 'none': unsupported on this model.
   */
  responseFormatStrategy?: 'native' | 'tool-synthesis' | 'none';
  /** Preferred JSON schema normalization dialect for this model/provider. */
  schemaDialect?: ResponseFormatDialect;
  /** Whether the provider honors the `toolChoice` parameter. */
  supportsToolChoice?: boolean;
}

export type ResponseFormatDialect = 'standard' | 'openai-strict' | 'gemini' | 'anthropic';

export function resolveResponseFormatStrategy(
  info: ModelInfo
): NonNullable<ModelInfo['responseFormatStrategy']> {
  if (info.responseFormatStrategy) return info.responseFormatStrategy;
  return info.supportsToolUse ? 'tool-synthesis' : 'none';
}

export function getSupportedResponseFormats(
  info: ModelInfo
): Array<'text' | 'json_object' | 'json_schema'> {
  return info.supportsResponseFormat ?? ['text'];
}
