/**
 * FAL image model definitions.
 *
 * @see https://fal.ai/models
 */

/** Known FAL image model identifiers. */
export type FalImageModelId =
  | 'fal-ai/flux-pro/v1.1'
  | 'fal-ai/flux-pro/v1.1-ultra'
  | 'fal-ai/flux-pro/v1.1-ultra-finetuned'
  | 'fal-ai/flux-pro/kontext'
  | 'fal-ai/flux-pro/kontext/max'
  | 'fal-ai/flux/dev'
  | 'fal-ai/flux/schnell'
  | 'fal-ai/flux-lora'
  | 'fal-ai/flux-general'
  | 'fal-ai/flux-general/image-to-image'
  | 'fal-ai/flux-general/inpainting'
  | 'fal-ai/luma-photon'
  | 'fal-ai/luma-photon/flash'
  | 'fal-ai/recraft/v3/text-to-image'
  | 'fal-ai/sana/sprint'
  | 'fal-ai/imagen4/preview'
  | (string & {});

/**
 * FAL image size type — either a named preset or explicit dimensions.
 */
export type FalImageSize =
  | 'square'
  | 'square_hd'
  | 'landscape_16_9'
  | 'landscape_4_3'
  | 'portrait_16_9'
  | 'portrait_4_3'
  | { width: number; height: number };

/** Model catalog with per-model constraints. */
export const FAL_IMAGE_MODELS: Record<string, { maxImagesPerCall: number }> = {
  'fal-ai/flux-pro/v1.1': { maxImagesPerCall: 1 },
  'fal-ai/flux-pro/v1.1-ultra': { maxImagesPerCall: 1 },
  'fal-ai/flux-pro/v1.1-ultra-finetuned': { maxImagesPerCall: 1 },
  'fal-ai/flux-pro/kontext': { maxImagesPerCall: 1 },
  'fal-ai/flux-pro/kontext/max': { maxImagesPerCall: 1 },
  'fal-ai/flux/dev': { maxImagesPerCall: 4 },
  'fal-ai/flux/schnell': { maxImagesPerCall: 4 },
  'fal-ai/flux-lora': { maxImagesPerCall: 4 },
  'fal-ai/flux-general': { maxImagesPerCall: 4 },
  'fal-ai/flux-general/image-to-image': { maxImagesPerCall: 1 },
  'fal-ai/flux-general/inpainting': { maxImagesPerCall: 1 },
  'fal-ai/luma-photon': { maxImagesPerCall: 1 },
  'fal-ai/luma-photon/flash': { maxImagesPerCall: 1 },
  'fal-ai/recraft/v3/text-to-image': { maxImagesPerCall: 1 },
  'fal-ai/sana/sprint': { maxImagesPerCall: 4 },
  'fal-ai/imagen4/preview': { maxImagesPerCall: 1 },
};
