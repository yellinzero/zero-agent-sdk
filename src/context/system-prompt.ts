/**
 * System prompt builder — assembles system prompts from various sources.
 */

import type { SDKTool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemPromptSection {
  title: string;
  content: string;
}

export interface SystemPromptConfig {
  /** Base system prompt text */
  basePrompt?: string;
  /** Tools to include descriptions for */
  tools?: SDKTool[];
  /** Content loaded from compatible instruction files (for example AGENTS.md / CLAUDE.md) */
  instructionContent?: string;
  /** Content from memory files */
  memoryContent?: string;
  /** Additional custom sections */
  customSections?: SystemPromptSection[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a complete system prompt by assembling multiple sources.
 *
 * Assembly order: basePrompt → Tools → Instruction files → Memory → Custom sections
 */
export async function buildSystemPrompt(config: SystemPromptConfig): Promise<string> {
  const parts: string[] = [];

  // 1. Base prompt
  if (config.basePrompt) {
    parts.push(config.basePrompt);
  }

  // 2. Tool descriptions
  if (config.tools && config.tools.length > 0) {
    const toolDescriptions: string[] = [];
    for (const tool of config.tools) {
      const desc = await tool.description({ tools: config.tools });
      toolDescriptions.push(`- **${tool.name}**: ${desc}`);
    }
    parts.push(`# Available Tools\n\n${toolDescriptions.join('\n')}`);
  }

  // 3. Instruction file content
  if (config.instructionContent) {
    parts.push(`# Project Instructions\n\n${config.instructionContent}`);
  }

  // 4. Memory content
  if (config.memoryContent) {
    parts.push(`# Memory\n\n${config.memoryContent}`);
  }

  // 5. Custom sections
  if (config.customSections) {
    for (const section of config.customSections) {
      parts.push(`# ${section.title}\n\n${section.content}`);
    }
  }

  return parts.join('\n\n---\n\n');
}
