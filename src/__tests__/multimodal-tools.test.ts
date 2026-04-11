/**
 * Tests for multimodal tool bridge functions.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  imageGenerationTool,
  speechGenerationTool,
  transcriptionTool,
} from '../tools/multimodal.js';

describe('imageGenerationTool', () => {
  it('should create a tool with correct name and schema', () => {
    const mockModel = {
      providerId: 'test',
      modelId: 'test-image',
      doGenerate: vi.fn(),
    };

    const tool = imageGenerationTool(mockModel);
    expect(tool.name).toBe('generate_image');
    expect(tool.isEnabled()).toBe(true);
    expect(tool.isConcurrencySafe({} as any)).toBe(true);
    expect(tool.isReadOnly({} as any)).toBe(false);
  });

  it('should accept custom name', () => {
    const mockModel = {
      providerId: 'test',
      modelId: 'test-image',
      doGenerate: vi.fn(),
    };

    const tool = imageGenerationTool(mockModel, { name: 'custom_image' });
    expect(tool.name).toBe('custom_image');
  });

  it('should call model and return result', async () => {
    const mockModel = {
      providerId: 'test',
      modelId: 'test-image',
      doGenerate: vi.fn().mockResolvedValue({
        images: [{ data: 'base64data', mediaType: 'image/png' }],
        warnings: [],
        response: { timestamp: new Date(), modelId: 'test-image' },
      }),
    };

    const tool = imageGenerationTool(mockModel);
    const result = await tool.call({ prompt: 'a cat' } as any, {} as any);

    expect(mockModel.doGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'a cat' }));
    expect((result.data as any).imageCount).toBe(1);
    expect(result.newMessages).toHaveLength(1);
  });
});

describe('speechGenerationTool', () => {
  it('should create a tool with correct name', () => {
    const mockModel = {
      providerId: 'test',
      modelId: 'test-speech',
      doGenerate: vi.fn(),
    };

    const tool = speechGenerationTool(mockModel);
    expect(tool.name).toBe('generate_speech');
  });

  it('should call model with text', async () => {
    const mockModel = {
      providerId: 'test',
      modelId: 'test-speech',
      doGenerate: vi.fn().mockResolvedValue({
        audio: { data: 'audiodata', mediaType: 'audio/mp3' },
        warnings: [],
        response: { timestamp: new Date(), modelId: 'test-speech' },
      }),
    };

    const tool = speechGenerationTool(mockModel);
    const result = await tool.call({ text: 'Hello world' } as any, {} as any);

    expect(mockModel.doGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello world' })
    );
    expect((result.data as any).audioFormat).toBe('audio/mp3');
  });
});

describe('transcriptionTool', () => {
  it('should create a tool with correct name and be read-only', () => {
    const mockModel = {
      providerId: 'test',
      modelId: 'test-transcription',
      doGenerate: vi.fn(),
    };

    const tool = transcriptionTool(mockModel);
    expect(tool.name).toBe('transcribe_audio');
    expect(tool.isReadOnly({} as any)).toBe(true);
  });

  it('should call model and return transcription', async () => {
    const mockModel = {
      providerId: 'test',
      modelId: 'test-transcription',
      doGenerate: vi.fn().mockResolvedValue({
        text: 'Hello world',
        segments: [{ text: 'Hello world', startSecond: 0, endSecond: 1 }],
        language: 'en',
        durationInSeconds: 1,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'test-transcription' },
      }),
    };

    const tool = transcriptionTool(mockModel);
    const result = await tool.call({ audioBase64: 'base64audio' } as any, {} as any);

    expect((result.data as any).text).toBe('Hello world');
    expect((result.data as any).language).toBe('en');
  });
});
