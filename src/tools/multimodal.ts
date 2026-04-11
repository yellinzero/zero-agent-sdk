/**
 * Multimodal tool bridge — wraps multimodal models as SDKTool instances.
 * This allows agents to use image generation, speech synthesis, and
 * transcription as regular tools in their toolchain.
 */

import { z } from 'zod';
import type { ImageModel, SpeechModel, TranscriptionModel } from '../providers/multimodal.js';
import type { SDKTool } from './types.js';
import { buildSDKTool } from './types.js';

// ---------------------------------------------------------------------------
// Image Generation Tool
// ---------------------------------------------------------------------------

/**
 * Wrap an ImageModel as an SDKTool for agent use.
 */
export function imageGenerationTool(
  model: ImageModel,
  options?: { name?: string; description?: string }
): SDKTool {
  const name = options?.name ?? 'generate_image';
  const desc = options?.description ?? 'Generate an image from a text description.';

  return buildSDKTool({
    name,
    inputSchema: z.object({
      prompt: z.string().describe('Text description of the image to generate'),
      size: z.string().optional().describe('Image size, e.g. "1024x1024"'),
      n: z.number().optional().describe('Number of images to generate (default 1)'),
    }),
    maxResultSizeChars: 10_000,

    async call(args) {
      const result = await model.doGenerate({
        prompt: args.prompt,
        size: args.size as `${number}x${number}` | undefined,
        n: args.n,
      });

      const imageDescriptions = result.images.map((img, i) => {
        const sizeKb =
          typeof img.data === 'string'
            ? Math.round((img.data.length * 0.75) / 1024)
            : Math.round(img.data.byteLength / 1024);
        return `Image ${i + 1}: ${img.mediaType} (~${sizeKb}KB)`;
      });

      return {
        data: {
          imageCount: result.images.length,
          images: imageDescriptions,
          model: result.response.modelId,
        },
        newMessages: result.images.map((img) => ({
          role: 'user' as const,
          content: [
            {
              type: 'image' as const,
              source: {
                type: 'base64',
                media_type: img.mediaType,
                data:
                  typeof img.data === 'string'
                    ? img.data
                    : Buffer.from(img.data).toString('base64'),
              },
            },
          ],
        })),
      };
    },

    async description() {
      return desc;
    },

    async prompt() {
      return `${desc} Provider: ${model.providerId}, Model: ${model.modelId}`;
    },

    isConcurrencySafe: () => true,
    isReadOnly: () => false,
  });
}

// ---------------------------------------------------------------------------
// Speech Generation Tool
// ---------------------------------------------------------------------------

/**
 * Wrap a SpeechModel as an SDKTool for agent use.
 */
export function speechGenerationTool(
  model: SpeechModel,
  options?: { name?: string; description?: string }
): SDKTool {
  const name = options?.name ?? 'generate_speech';
  const desc = options?.description ?? 'Generate speech audio from text.';

  return buildSDKTool({
    name,
    inputSchema: z.object({
      text: z.string().describe('Text to convert to speech'),
      voice: z.string().optional().describe('Voice ID to use'),
    }),
    maxResultSizeChars: 10_000,

    async call(args) {
      const result = await model.doGenerate({
        text: args.text,
        voice: args.voice,
      });

      const sizeKb =
        typeof result.audio.data === 'string'
          ? Math.round((result.audio.data.length * 0.75) / 1024)
          : Math.round(result.audio.data.byteLength / 1024);

      return {
        data: {
          audioFormat: result.audio.mediaType,
          audioSizeKb: sizeKb,
          model: result.response.modelId,
        },
      };
    },

    async description() {
      return desc;
    },

    async prompt() {
      return `${desc} Provider: ${model.providerId}, Model: ${model.modelId}`;
    },

    isConcurrencySafe: () => true,
    isReadOnly: () => false,
  });
}

// ---------------------------------------------------------------------------
// Transcription Tool
// ---------------------------------------------------------------------------

/**
 * Wrap a TranscriptionModel as an SDKTool for agent use.
 */
export function transcriptionTool(
  model: TranscriptionModel,
  options?: { name?: string; description?: string }
): SDKTool {
  const name = options?.name ?? 'transcribe_audio';
  const desc = options?.description ?? 'Transcribe audio to text.';

  return buildSDKTool({
    name,
    inputSchema: z.object({
      audioBase64: z.string().describe('Base64-encoded audio data'),
      mediaType: z.string().optional().describe('Audio MIME type (e.g. "audio/wav")'),
    }),
    maxResultSizeChars: 100_000,

    async call(args) {
      const result = await model.doGenerate({
        audio: args.audioBase64,
        mediaType: args.mediaType ?? 'audio/wav',
      });

      return {
        data: {
          text: result.text,
          segments: result.segments,
          language: result.language,
          durationInSeconds: result.durationInSeconds,
        },
      };
    },

    async description() {
      return desc;
    },

    async prompt() {
      return `${desc} Provider: ${model.providerId}, Model: ${model.modelId}`;
    },

    isConcurrencySafe: () => true,
    isReadOnly: () => true,
  });
}
