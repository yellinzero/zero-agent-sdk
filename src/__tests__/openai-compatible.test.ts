import { describe, expect, it } from 'vitest';
import {
  createOpenAICompatible,
  GenericOpenAICompatibleProvider,
} from '../providers/openai-compatible/generic.js';

// Check if the openai package is available
let openaiAvailable = false;
try {
  require('openai');
  openaiAvailable = true;
} catch {
  openaiAvailable = false;
}

describe('GenericOpenAICompatibleProvider', () => {
  it('should have correct providerId', () => {
    const provider = createOpenAICompatible({
      providerId: 'test-provider',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(provider.providerId).toBe('test-provider');
  });

  it('should return default model info for unknown models', () => {
    const provider = createOpenAICompatible({
      providerId: 'test',
      baseUrl: 'http://localhost:11434/v1',
    });
    const info = provider.getModelInfo('unknown-model');
    expect(info.contextWindow).toBe(128_000);
    expect(info.maxOutputTokens).toBe(16_384);
    expect(info.supportsToolUse).toBe(true);
  });

  it('should return configured model info', () => {
    const provider = createOpenAICompatible({
      providerId: 'test',
      baseUrl: 'http://localhost:11434/v1',
      models: {
        'my-model': {
          contextWindow: 32_000,
          maxOutputTokens: 4_096,
          supportsThinking: false,
          supportsToolUse: true,
          supportsImages: false,
          supportsPdfInput: false,
        },
      },
    });
    const info = provider.getModelInfo('my-model');
    expect(info.contextWindow).toBe(32_000);
    expect(info.maxOutputTokens).toBe(4_096);
  });

  it('should be instanceof GenericOpenAICompatibleProvider', () => {
    const provider = createOpenAICompatible({
      providerId: 'test',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(provider).toBeInstanceOf(GenericOpenAICompatibleProvider);
  });

  it.skipIf(openaiAvailable)('should throw when openai package is not installed', async () => {
    const provider = createOpenAICompatible({
      providerId: 'test',
      apiKey: 'test-key',
      baseUrl: 'http://localhost:11434/v1',
    });
    await expect(
      provider.generateMessage({
        model: 'test-model',
        messages: [],
        systemPrompt: 'test',
      })
    ).rejects.toThrow('Failed to import openai');
  });
});
