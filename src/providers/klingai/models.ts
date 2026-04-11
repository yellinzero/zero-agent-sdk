/**
 * KlingAI video generation model catalog.
 *
 * @see https://app.klingai.com/global/dev/document-api
 */
export const KLINGAI_MODELS: Record<string, { description: string }> = {
  // Text-to-Video
  'kling-v1-t2v': { description: 'Kling v1 — text-to-video' },
  'kling-v1.6-t2v': { description: 'Kling v1.6 — text-to-video' },
  'kling-v2-master-t2v': { description: 'Kling v2 Master — text-to-video' },
  'kling-v2.1-master-t2v': { description: 'Kling v2.1 Master — text-to-video' },
  'kling-v2.5-turbo-t2v': { description: 'Kling v2.5 Turbo — text-to-video' },
  'kling-v2.6-t2v': { description: 'Kling v2.6 — text-to-video' },
  'kling-v3.0-t2v': { description: 'Kling v3.0 — text-to-video' },
  // Image-to-Video
  'kling-v1-i2v': { description: 'Kling v1 — image-to-video' },
  'kling-v1.5-i2v': { description: 'Kling v1.5 — image-to-video' },
  'kling-v1.6-i2v': { description: 'Kling v1.6 — image-to-video' },
  'kling-v2-master-i2v': { description: 'Kling v2 Master — image-to-video' },
  'kling-v2.1-i2v': { description: 'Kling v2.1 — image-to-video' },
  'kling-v2.1-master-i2v': { description: 'Kling v2.1 Master — image-to-video' },
  'kling-v2.5-turbo-i2v': { description: 'Kling v2.5 Turbo — image-to-video' },
  'kling-v2.6-i2v': { description: 'Kling v2.6 — image-to-video' },
  'kling-v3.0-i2v': { description: 'Kling v3.0 — image-to-video' },
  // Motion Control
  'kling-v2.6-motion-control': { description: 'Kling v2.6 — motion control' },
  'kling-v3.0-motion-control': { description: 'Kling v3.0 — motion control' },
};
