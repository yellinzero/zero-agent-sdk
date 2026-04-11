/**
 * Tests for multimodal interfaces and generation functions.
 */

import { describe, expect, it } from 'vitest';
import {
  embed,
  embedMany,
  generateImage,
  generateSpeech,
  generateVideo,
  transcribe,
} from '../generate.js';
import type {
  EmbeddingModel,
  ImageModel,
  SpeechModel,
  TranscriptionModel,
  VideoModel,
} from '../providers/multimodal.js';

// ---------------------------------------------------------------------------
// Mock models
// ---------------------------------------------------------------------------

function createMockImageModel(overrides: Partial<ImageModel> = {}): ImageModel {
  return {
    providerId: 'test-image',
    modelId: 'test-model',
    maxImagesPerCall: 4,
    async doGenerate() {
      return {
        images: [{ data: 'base64data', mediaType: 'image/png' }],
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: 'test-model',
        },
      };
    },
    ...overrides,
  };
}

function createMockSpeechModel(overrides: Partial<SpeechModel> = {}): SpeechModel {
  return {
    providerId: 'test-speech',
    modelId: 'test-tts',
    async doGenerate() {
      return {
        audio: { data: 'base64audio', mediaType: 'audio/mp3' },
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: 'test-tts',
        },
      };
    },
    ...overrides,
  };
}

function createMockTranscriptionModel(
  overrides: Partial<TranscriptionModel> = {}
): TranscriptionModel {
  return {
    providerId: 'test-transcription',
    modelId: 'test-stt',
    async doGenerate() {
      return {
        text: 'Hello world',
        segments: [{ text: 'Hello world', startSecond: 0, endSecond: 1.5 }],
        language: 'en',
        durationInSeconds: 1.5,
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: 'test-stt',
        },
      };
    },
    ...overrides,
  };
}

function createMockVideoModel(overrides: Partial<VideoModel> = {}): VideoModel {
  return {
    providerId: 'test-video',
    modelId: 'test-video-model',
    maxVideosPerCall: 1,
    async doGenerate() {
      return {
        videos: [
          { type: 'url' as const, url: 'https://example.com/video.mp4', mediaType: 'video/mp4' },
        ],
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: 'test-video-model',
        },
      };
    },
    ...overrides,
  };
}

function createMockEmbeddingModel(overrides: Partial<EmbeddingModel> = {}): EmbeddingModel {
  return {
    providerId: 'test-embedding',
    modelId: 'test-embed',
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    async doEmbed() {
      return {
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { tokens: 5 },
        warnings: [],
      };
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Multimodal interfaces', () => {
  it('ImageModel interface should have required properties', () => {
    const model = createMockImageModel();
    expect(model.providerId).toBe('test-image');
    expect(model.modelId).toBe('test-model');
    expect(model.maxImagesPerCall).toBe(4);
    expect(typeof model.doGenerate).toBe('function');
  });

  it('SpeechModel interface should have required properties', () => {
    const model = createMockSpeechModel();
    expect(model.providerId).toBe('test-speech');
    expect(model.modelId).toBe('test-tts');
  });

  it('TranscriptionModel interface should have required properties', () => {
    const model = createMockTranscriptionModel();
    expect(model.providerId).toBe('test-transcription');
    expect(model.modelId).toBe('test-stt');
  });

  it('VideoModel interface should have required properties', () => {
    const model = createMockVideoModel();
    expect(model.providerId).toBe('test-video');
    expect(model.maxVideosPerCall).toBe(1);
  });

  it('EmbeddingModel interface should have required properties', () => {
    const model = createMockEmbeddingModel();
    expect(model.providerId).toBe('test-embedding');
    expect(model.maxEmbeddingsPerCall).toBe(100);
    expect(model.supportsParallelCalls).toBe(true);
  });
});

describe('generateImage', () => {
  it('should return images and a shorthand image property', async () => {
    const model = createMockImageModel();
    const result = await generateImage({ model, prompt: 'a cat' });

    expect(result.images).toHaveLength(1);
    expect(result.image).toEqual(result.images[0]);
    expect(result.image.mediaType).toBe('image/png');
    expect(result.warnings).toEqual([]);
  });

  it('should pass options through to the model', async () => {
    let receivedOptions: unknown;
    const model = createMockImageModel({
      async doGenerate(options) {
        receivedOptions = options;
        return {
          images: [{ data: 'x', mediaType: 'image/png' }],
          warnings: [],
          response: { timestamp: new Date(), modelId: 'test' },
        };
      },
    });

    await generateImage({
      model,
      prompt: 'a dog',
      n: 2,
      size: '512x512',
      seed: 42,
    });

    expect(receivedOptions).toMatchObject({
      prompt: 'a dog',
      n: 2,
      size: '512x512',
      seed: 42,
    });
  });

  it('should retry on failure', async () => {
    let calls = 0;
    const model = createMockImageModel({
      async doGenerate() {
        calls++;
        if (calls < 3) throw new Error('transient');
        return {
          images: [{ data: 'ok', mediaType: 'image/png' }],
          warnings: [],
          response: { timestamp: new Date(), modelId: 'test' },
        };
      },
    });

    const result = await generateImage({ model, prompt: 'retry test', maxRetries: 3 });
    expect(result.images).toHaveLength(1);
    expect(calls).toBe(3);
  });
});

describe('generateSpeech', () => {
  it('should return audio data', async () => {
    const model = createMockSpeechModel();
    const result = await generateSpeech({ model, text: 'hello' });

    expect(result.audio.mediaType).toBe('audio/mp3');
    expect(result.warnings).toEqual([]);
  });
});

describe('transcribe', () => {
  it('should return transcription with segments', async () => {
    const model = createMockTranscriptionModel();
    const result = await transcribe({
      model,
      audio: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/wav',
    });

    expect(result.text).toBe('Hello world');
    expect(result.segments).toHaveLength(1);
    expect(result.language).toBe('en');
    expect(result.durationInSeconds).toBe(1.5);
  });
});

describe('generateVideo', () => {
  it('should return video data', async () => {
    const model = createMockVideoModel();
    const result = await generateVideo({ model, prompt: 'a cat running' });

    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].type).toBe('url');
  });
});

describe('embed', () => {
  it('should return a single embedding', async () => {
    const model = createMockEmbeddingModel();
    const result = await embed({ model, value: 'hello' });

    expect(result.value).toBe('hello');
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.usage).toEqual({ tokens: 5 });
  });
});

describe('embedMany', () => {
  it('should return multiple embeddings', async () => {
    const model = createMockEmbeddingModel({
      async doEmbed({ values }) {
        return {
          embeddings: values.map(() => [0.1, 0.2]),
          usage: { tokens: values.length * 3 },
          warnings: [],
        };
      },
    });

    const result = await embedMany({ model, values: ['a', 'b', 'c'] });
    expect(result.embeddings).toHaveLength(3);
    expect(result.usage).toEqual({ tokens: 9 });
  });
});
