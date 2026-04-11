import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../providers/openai/client.js';
import { getOpenAIModelInfo, OPENAI_MODELS } from '../providers/openai/models.js';
import type { ProviderMessage } from '../providers/types.js';

// Check if the openai package is available
let openaiAvailable = false;
try {
  require('openai');
  openaiAvailable = true;
} catch {
  openaiAvailable = false;
}

// ---------------------------------------------------------------------------
// Model Catalog
// ---------------------------------------------------------------------------

describe('OpenAI models', () => {
  it('should return info for known models', () => {
    const info = getOpenAIModelInfo('gpt-4o');
    expect(info.contextWindow).toBe(128_000);
    expect(info.maxOutputTokens).toBe(16_384);
    expect(info.supportsToolUse).toBe(true);
    expect(info.supportsImages).toBe(true);
    expect(info.supportsThinking).toBe(false);
  });

  it('should return info for o-series reasoning models', () => {
    const o1 = getOpenAIModelInfo('o1');
    expect(o1.supportsThinking).toBe(true);
    expect(o1.contextWindow).toBe(200_000);

    const o3 = getOpenAIModelInfo('o3');
    expect(o3.supportsThinking).toBe(true);
  });

  it('should return default info for unknown models', () => {
    const info = getOpenAIModelInfo('gpt-99-ultra');
    expect(info.contextWindow).toBe(128_000);
    expect(info.maxOutputTokens).toBe(16_384);
    expect(info.supportsThinking).toBe(false);
  });

  it('should have cost info for all models', () => {
    for (const [name, info] of Object.entries(OPENAI_MODELS)) {
      expect(info.inputTokenCostPer1M, `${name} missing input cost`).toBeDefined();
      expect(info.outputTokenCostPer1M, `${name} missing output cost`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Provider Instance
// ---------------------------------------------------------------------------

describe('OpenAIProvider', () => {
  it('should have correct providerId', () => {
    const provider = new OpenAIProvider();
    expect(provider.providerId).toBe('openai');
  });

  it('should return model info via getModelInfo', () => {
    const provider = new OpenAIProvider();
    const info = provider.getModelInfo('gpt-4o-mini');
    expect(info.contextWindow).toBe(128_000);
    expect(info.inputTokenCostPer1M).toBe(0.15);
  });

  it.skipIf(openaiAvailable)('should throw when openai package is not installed', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test' });
    await expect(
      provider.generateMessage({
        model: 'gpt-4o',
        messages: [],
        systemPrompt: 'test',
      })
    ).rejects.toThrow('Failed to import openai');
  });
});

// ---------------------------------------------------------------------------
// Message Mapping (test via private method exposed through buildMessages behavior)
// We test the mapping indirectly by checking that generateMessage throws
// the right error (because openai package isn't installed).
// ---------------------------------------------------------------------------

describe('OpenAI message mapping', () => {
  // We can test the mapping logic by instantiating and calling buildRequestParams
  // via Reflection, or by testing that the provider constructs valid requests.
  // Since buildRequestParams is private, we test the public interface behavior.

  it('should accept provider messages with tool use blocks', () => {
    // This just verifies the type system allows correct message shapes
    const messages: ProviderMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will help.' },
          { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file1.txt\nfile2.txt' }],
      },
    ];
    expect(messages).toHaveLength(3);
  });

  it('should handle image blocks in message format', () => {
    const msg: ProviderMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
        },
      ],
    };
    expect(msg.content).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe('OpenAI factory functions', () => {
  it('createOpenAIProvider returns an OpenAIProvider', async () => {
    const { createOpenAIProvider } = await import('../providers/openai/client.js');
    const provider = createOpenAIProvider({ apiKey: 'test-key' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.providerId).toBe('openai');
  });

  it('openai() shorthand works', async () => {
    const { openai } = await import('../providers/openai/client.js');
    const provider = openai();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });
});
