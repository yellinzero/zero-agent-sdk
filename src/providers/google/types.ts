/**
 * Google Gemini API types (minimal, to avoid SDK dependency).
 */

export interface GoogleContent {
  role: 'user' | 'model';
  parts: GooglePart[];
}

export type GooglePart =
  | GoogleTextPart
  | GoogleInlineDataPart
  | GoogleFunctionCallPart
  | GoogleFunctionResponsePart;

export interface GoogleTextPart {
  text: string;
}

export interface GoogleInlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export interface GoogleFunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
}

export interface GoogleFunctionResponsePart {
  functionResponse: {
    name: string;
    response: { content: string };
  };
}

export interface GoogleTool {
  functionDeclarations: GoogleFunctionDeclaration[];
}

export interface GoogleFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GoogleGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface GoogleGenerateContentRequest {
  contents: GoogleContent[];
  systemInstruction?: { parts: GoogleTextPart[] };
  tools?: GoogleTool[];
  generationConfig?: GoogleGenerationConfig;
}

export interface GoogleGenerateContentResponse {
  candidates?: GoogleCandidate[];
  usageMetadata?: GoogleUsageMetadata;
}

export interface GoogleCandidate {
  content?: { parts?: GooglePart[] };
  finishReason?: string;
}

export interface GoogleUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GoogleStreamChunk {
  candidates?: GoogleCandidate[];
  usageMetadata?: GoogleUsageMetadata;
}
