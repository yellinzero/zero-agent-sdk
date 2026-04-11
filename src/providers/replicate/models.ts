/**
 * Replicate image model definitions.
 *
 * @see https://replicate.com/explore
 */

/** Known Replicate image model identifiers (owner/model or owner/model:version). */
export type ReplicateImageModelId =
  | 'black-forest-labs/flux-1.1-pro'
  | 'black-forest-labs/flux-1.1-pro-ultra'
  | 'black-forest-labs/flux-dev'
  | 'black-forest-labs/flux-pro'
  | 'black-forest-labs/flux-schnell'
  | 'black-forest-labs/flux-2-pro'
  | 'black-forest-labs/flux-2-dev'
  | 'black-forest-labs/flux-fill-pro'
  | 'black-forest-labs/flux-fill-dev'
  | 'stability-ai/stable-diffusion-3.5-large'
  | 'stability-ai/stable-diffusion-3.5-large-turbo'
  | 'stability-ai/stable-diffusion-3.5-medium'
  | 'bytedance/sdxl-lightning-4step'
  | 'ideogram-ai/ideogram-v2'
  | 'ideogram-ai/ideogram-v2-turbo'
  | 'recraft-ai/recraft-v3'
  | 'luma/photon'
  | 'luma/photon-flash'
  | (string & {});

/** Model catalog with per-model constraints. */
export const REPLICATE_IMAGE_MODELS: Record<string, { maxImagesPerCall: number }> = {
  'black-forest-labs/flux-1.1-pro': { maxImagesPerCall: 1 },
  'black-forest-labs/flux-1.1-pro-ultra': { maxImagesPerCall: 1 },
  'black-forest-labs/flux-dev': { maxImagesPerCall: 1 },
  'black-forest-labs/flux-pro': { maxImagesPerCall: 1 },
  'black-forest-labs/flux-schnell': { maxImagesPerCall: 4 },
  'black-forest-labs/flux-2-pro': { maxImagesPerCall: 8 },
  'black-forest-labs/flux-2-dev': { maxImagesPerCall: 8 },
  'black-forest-labs/flux-fill-pro': { maxImagesPerCall: 1 },
  'black-forest-labs/flux-fill-dev': { maxImagesPerCall: 1 },
  'stability-ai/stable-diffusion-3.5-large': { maxImagesPerCall: 4 },
  'stability-ai/stable-diffusion-3.5-large-turbo': { maxImagesPerCall: 4 },
  'stability-ai/stable-diffusion-3.5-medium': { maxImagesPerCall: 4 },
  'bytedance/sdxl-lightning-4step': { maxImagesPerCall: 4 },
  'ideogram-ai/ideogram-v2': { maxImagesPerCall: 1 },
  'ideogram-ai/ideogram-v2-turbo': { maxImagesPerCall: 1 },
  'recraft-ai/recraft-v3': { maxImagesPerCall: 1 },
  'luma/photon': { maxImagesPerCall: 1 },
  'luma/photon-flash': { maxImagesPerCall: 1 },
};
