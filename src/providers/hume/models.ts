/**
 * Hume speech synthesis model catalog.
 *
 * Hume uses a single model endpoint; voice is configured per-utterance.
 * @see https://dev.hume.ai/reference/text-to-speech-tts
 */
export const HUME_MODELS: Record<string, { description: string }> = {
  default: { description: 'Default — Hume expressive TTS model' },
};
