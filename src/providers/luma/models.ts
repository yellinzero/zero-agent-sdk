/**
 * Luma AI image model definitions.
 *
 * @see https://docs.lumalabs.ai/docs/image-generation
 */

/** Known Luma image model identifiers. */
export type LumaImageModelId = 'photon-1' | 'photon-flash-1' | (string & {});

/** Model catalog with per-model constraints. */
export const LUMA_IMAGE_MODELS: Record<string, { maxImagesPerCall: number }> = {
  'photon-1': { maxImagesPerCall: 1 },
  'photon-flash-1': { maxImagesPerCall: 1 },
};
