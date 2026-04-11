/**
 * Prodia image model definitions.
 *
 * @see https://docs.prodia.com/reference
 */

/** Known Prodia image model identifiers (job type strings). */
export type ProdiaImageModelId =
  | 'inference.flux-fast.schnell.txt2img.v2'
  | 'inference.flux.schnell.txt2img.v2'
  | (string & {});

/** Model catalog with per-model constraints. */
export const PRODIA_IMAGE_MODELS: Record<string, { maxImagesPerCall: number }> = {
  'inference.flux-fast.schnell.txt2img.v2': { maxImagesPerCall: 1 },
  'inference.flux.schnell.txt2img.v2': { maxImagesPerCall: 1 },
};
