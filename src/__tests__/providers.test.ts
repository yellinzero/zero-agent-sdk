import { describe, expect, it } from 'vitest';

// Check if the openai and AWS SDK packages are available
let openaiAvailable = false;
let awsSdkAvailable = false;
try {
  require('openai');
  openaiAvailable = true;
} catch {
  openaiAvailable = false;
}
try {
  require('@aws-sdk/client-bedrock-runtime');
  awsSdkAvailable = true;
} catch {
  awsSdkAvailable = false;
}

import {
  ALIBABA_MODELS,
  AlibabaProvider,
  getAlibabaModelInfo,
} from '../providers/alibaba/index.js';
import {
  BEDROCK_MODELS,
  BedrockProvider,
  getBedrockModelInfo,
} from '../providers/amazon-bedrock/index.js';
import { AzureOpenAIProvider, getAzureModelInfo } from '../providers/azure/index.js';
import { BasetenProvider, getBasetenModelInfo } from '../providers/baseten/index.js';
import { CerebrasProvider, getCerebrasModelInfo } from '../providers/cerebras/index.js';
import { COHERE_MODELS, CohereProvider, getCohereModelInfo } from '../providers/cohere/index.js';
import { DeepInfraProvider, getDeepInfraModelInfo } from '../providers/deepinfra/index.js';
import {
  DEEPSEEK_MODELS,
  DeepSeekProvider,
  getDeepSeekModelInfo,
} from '../providers/deepseek/index.js';
import { FireworksProvider, getFireworksModelInfo } from '../providers/fireworks/index.js';
import { GOOGLE_MODELS, GoogleProvider, getGoogleModelInfo } from '../providers/google/index.js';
import { getVertexModelInfo, VertexAIProvider } from '../providers/google-vertex/index.js';
import { GROQ_MODELS, GroqProvider, getGroqModelInfo } from '../providers/groq/index.js';
import { getHuggingFaceModelInfo, HuggingFaceProvider } from '../providers/huggingface/index.js';
import {
  getMistralModelInfo,
  MISTRAL_MODELS,
  MistralProvider,
} from '../providers/mistral/index.js';
import { getMoonshotAIModelInfo, MoonshotAIProvider } from '../providers/moonshotai/index.js';
import {
  getPerplexityModelInfo,
  PERPLEXITY_MODELS,
  PerplexityProvider,
} from '../providers/perplexity/index.js';
import { getTogetherAIModelInfo, TogetherAIProvider } from '../providers/togetherai/index.js';
import { getXAIModelInfo, XAI_MODELS, XAIProvider } from '../providers/xai/index.js';

// ---------------------------------------------------------------------------
// Provider ID tests
// ---------------------------------------------------------------------------

describe('Provider IDs', () => {
  const providers = [
    { name: 'DeepSeek', cls: DeepSeekProvider, id: 'deepseek' },
    { name: 'Mistral', cls: MistralProvider, id: 'mistral' },
    { name: 'Alibaba', cls: AlibabaProvider, id: 'alibaba' },
    { name: 'Azure', cls: AzureOpenAIProvider, id: 'azure' },
    { name: 'Google', cls: GoogleProvider, id: 'google' },
    { name: 'xAI', cls: XAIProvider, id: 'xai' },
    { name: 'Groq', cls: GroqProvider, id: 'groq' },
    { name: 'TogetherAI', cls: TogetherAIProvider, id: 'togetherai' },
    { name: 'HuggingFace', cls: HuggingFaceProvider, id: 'huggingface' },
    { name: 'MoonshotAI', cls: MoonshotAIProvider, id: 'moonshotai' },
    { name: 'VertexAI', cls: VertexAIProvider, id: 'google-vertex' },
    { name: 'Bedrock', cls: BedrockProvider, id: 'amazon-bedrock' },
    { name: 'Perplexity', cls: PerplexityProvider, id: 'perplexity' },
    { name: 'Fireworks', cls: FireworksProvider, id: 'fireworks' },
    { name: 'Cerebras', cls: CerebrasProvider, id: 'cerebras' },
    { name: 'DeepInfra', cls: DeepInfraProvider, id: 'deepinfra' },
    { name: 'Baseten', cls: BasetenProvider, id: 'baseten' },
    { name: 'Cohere', cls: CohereProvider, id: 'cohere' },
  ];

  for (const { name, cls, id } of providers) {
    it(`${name} should have providerId "${id}"`, () => {
      const provider = new cls();
      expect(provider.providerId).toBe(id);
    });
  }
});

// ---------------------------------------------------------------------------
// Model info tests
// ---------------------------------------------------------------------------

describe('DeepSeek models', () => {
  it('should return info for deepseek-chat', () => {
    const info = getDeepSeekModelInfo('deepseek-chat');
    expect(info.contextWindow).toBe(64_000);
    expect(info.supportsToolUse).toBe(true);
  });

  it('should return info for deepseek-reasoner', () => {
    const info = getDeepSeekModelInfo('deepseek-reasoner');
    expect(info.supportsThinking).toBe(true);
  });

  it('should return default for unknown models', () => {
    const info = getDeepSeekModelInfo('unknown');
    expect(info.contextWindow).toBe(64_000);
    expect(info.supportsThinking).toBe(false);
  });
});

describe('Mistral models', () => {
  it('should return info for mistral-large-latest', () => {
    const info = getMistralModelInfo('mistral-large-latest');
    expect(info.contextWindow).toBe(128_000);
    expect(info.supportsImages).toBe(true);
  });

  it('should return info for magistral models with thinking', () => {
    const info = getMistralModelInfo('magistral-medium-latest');
    expect(info.supportsThinking).toBe(true);
  });

  it('should have cost info for all models', () => {
    for (const [name, info] of Object.entries(MISTRAL_MODELS)) {
      expect(info.inputTokenCostPer1M, `${name} missing input cost`).toBeDefined();
    }
  });
});

describe('Alibaba models', () => {
  it('should return info for qwen3-max', () => {
    const info = getAlibabaModelInfo('qwen3-max');
    expect(info.supportsThinking).toBe(true);
    expect(info.supportsImages).toBe(true);
  });

  it('should return info for qwq-plus', () => {
    const info = getAlibabaModelInfo('qwq-plus');
    expect(info.supportsThinking).toBe(true);
  });
});

describe('Google models', () => {
  it('should return info for gemini-2.5-pro', () => {
    const info = getGoogleModelInfo('gemini-2.5-pro');
    expect(info.contextWindow).toBe(1_048_576);
    expect(info.supportsThinking).toBe(true);
    expect(info.supportsPdfInput).toBe(true);
  });

  it('should return info for gemini-2.0-flash', () => {
    const info = getGoogleModelInfo('gemini-2.0-flash');
    expect(info.supportsThinking).toBe(false);
  });

  it('should return default for unknown models', () => {
    const info = getGoogleModelInfo('gemini-99');
    expect(info.contextWindow).toBe(1_048_576);
  });
});

describe('xAI models', () => {
  it('should return info for grok-3', () => {
    const info = getXAIModelInfo('grok-3');
    expect(info.contextWindow).toBe(131_072);
    expect(info.supportsToolUse).toBe(true);
  });

  it('should return info for grok-3-mini with thinking', () => {
    const info = getXAIModelInfo('grok-3-mini');
    expect(info.supportsThinking).toBe(true);
  });
});

describe('Groq models', () => {
  it('should return info for llama models', () => {
    const info = getGroqModelInfo('llama-3.3-70b-versatile');
    expect(info.contextWindow).toBe(128_000);
  });
});

describe('Perplexity models', () => {
  it('should return info for sonar-pro', () => {
    const info = getPerplexityModelInfo('sonar-pro');
    expect(info.supportsToolUse).toBe(false);
  });

  it('should return info for sonar-reasoning models', () => {
    const info = getPerplexityModelInfo('sonar-reasoning-pro');
    expect(info.supportsThinking).toBe(true);
  });
});

describe('Cohere models', () => {
  it('should return info for command-r-plus', () => {
    const info = getCohereModelInfo('command-r-plus');
    expect(info.supportsToolUse).toBe(true);
  });

  it('should return info for command-a', () => {
    const info = getCohereModelInfo('command-a');
    expect(info.contextWindow).toBe(256_000);
    expect(info.supportsImages).toBe(true);
  });
});

describe('Bedrock models', () => {
  it('should return info for anthropic models on bedrock', () => {
    const info = getBedrockModelInfo('anthropic.claude-3-5-sonnet-20241022-v2:0');
    expect(info.contextWindow).toBe(200_000);
  });
});

describe('Vertex AI models', () => {
  it('should share model catalog with Google Gemini', () => {
    const vertexInfo = getVertexModelInfo('gemini-2.5-pro');
    const googleInfo = getGoogleModelInfo('gemini-2.5-pro');
    expect(vertexInfo).toEqual(googleInfo);
  });
});

// ---------------------------------------------------------------------------
// SDK package missing tests (OpenAI-compatible providers)
// ---------------------------------------------------------------------------

describe.skipIf(openaiAvailable)('OpenAI-compatible providers throw when openai is missing', () => {
  const providers = [
    { name: 'DeepSeek', create: () => new DeepSeekProvider({ apiKey: 'test' }) },
    { name: 'Mistral', create: () => new MistralProvider({ apiKey: 'test' }) },
    { name: 'Alibaba', create: () => new AlibabaProvider({ apiKey: 'test' }) },
    { name: 'xAI', create: () => new XAIProvider({ apiKey: 'test' }) },
    { name: 'Groq', create: () => new GroqProvider({ apiKey: 'test' }) },
    { name: 'Perplexity', create: () => new PerplexityProvider({ apiKey: 'test' }) },
    { name: 'Cerebras', create: () => new CerebrasProvider({ apiKey: 'test' }) },
    { name: 'Cohere', create: () => new CohereProvider({ apiKey: 'test' }) },
  ];

  for (const { name, create } of providers) {
    it(`${name} should throw when openai package is not installed`, async () => {
      const provider = create();
      await expect(
        provider.generateMessage({
          model: 'test',
          messages: [],
          systemPrompt: 'test',
        })
      ).rejects.toThrow('Failed to import openai');
    });
  }
});

// ---------------------------------------------------------------------------
// Bedrock throws when AWS SDK missing
// ---------------------------------------------------------------------------

describe.skipIf(awsSdkAvailable)('Bedrock provider', () => {
  it('should throw when @aws-sdk/client-bedrock-runtime is not installed', async () => {
    const provider = new BedrockProvider();
    await expect(
      provider.generateMessage({
        model: 'test',
        messages: [],
        systemPrompt: 'test',
      })
    ).rejects.toThrow('Failed to import @aws-sdk/client-bedrock-runtime');
  });
});
