/**
 * Tests for the Open Responses provider.
 */

import { describe, expect, it } from 'vitest';
import {
  createOpenResponses,
  OPEN_RESPONSES_DEFAULT_MODEL_INFO,
  OpenResponsesProvider,
} from '../providers/open-responses/index.js';

describe('OpenResponsesProvider', () => {
  it('should create a provider with required config', () => {
    const provider = createOpenResponses({
      name: 'test',
      url: 'http://localhost:1234/v1/responses',
    });

    expect(provider).toBeInstanceOf(OpenResponsesProvider);
    expect(provider.providerId).toBe('test');
  });

  it('should have default model info', () => {
    expect(OPEN_RESPONSES_DEFAULT_MODEL_INFO.contextWindow).toBe(128_000);
    expect(OPEN_RESPONSES_DEFAULT_MODEL_INFO.supportsThinking).toBe(true);
    expect(OPEN_RESPONSES_DEFAULT_MODEL_INFO.supportsToolUse).toBe(true);
  });

  it('should return default model info for unknown models', () => {
    const provider = createOpenResponses({
      name: 'test',
      url: 'http://localhost:1234/v1/responses',
    });

    const info = provider.getModelInfo('any-model');
    expect(info.contextWindow).toBe(128_000);
    expect(info.supportsToolUse).toBe(true);
  });

  it('should use custom model info when provided', () => {
    const customInfo = {
      contextWindow: 32_000,
      maxOutputTokens: 4_096,
      supportsThinking: false,
      supportsToolUse: false,
      supportsImages: true,
      supportsPdfInput: false,
    };

    const provider = createOpenResponses({
      name: 'custom',
      url: 'http://localhost:5000/v1/responses',
      defaultModelInfo: customInfo,
    });

    const info = provider.getModelInfo('any');
    expect(info.contextWindow).toBe(32_000);
    expect(info.supportsToolUse).toBe(false);
  });

  it('convenience alias should work', async () => {
    const { openResponses: or } = await import('../providers/open-responses/index.js');
    const p = or({
      name: 'alias-test',
      url: 'http://localhost/v1/responses',
    });
    expect(p.providerId).toBe('alias-test');
  });
});
