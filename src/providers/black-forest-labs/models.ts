/**
 * Black Forest Labs (FLUX) image model definitions.
 *
 * @see https://docs.bfl.ai
 */

/** Known Black Forest Labs image model identifiers. */
export type BlackForestLabsImageModelId =
  | 'flux-kontext-pro'
  | 'flux-kontext-max'
  | 'flux-pro-1.1-ultra'
  | 'flux-pro-1.1'
  | 'flux-pro-1.0-fill'
  | 'flux-dev'
  | 'flux-pro'
  | (string & {});

/** Model catalog with per-model constraints. */
export const BFL_IMAGE_MODELS: Record<string, { maxImagesPerCall: number }> = {
  'flux-kontext-pro': { maxImagesPerCall: 1 },
  'flux-kontext-max': { maxImagesPerCall: 1 },
  'flux-pro-1.1-ultra': { maxImagesPerCall: 1 },
  'flux-pro-1.1': { maxImagesPerCall: 1 },
  'flux-pro-1.0-fill': { maxImagesPerCall: 1 },
  'flux-dev': { maxImagesPerCall: 1 },
  'flux-pro': { maxImagesPerCall: 1 },
};
