/**
 * ElevenLabs speech and transcription model catalog.
 *
 * @see https://elevenlabs.io/docs
 */
export const ELEVENLABS_MODELS: Record<string, { description: string }> = {
  // Speech (TTS)
  eleven_v3: { description: 'ElevenLabs v3 — latest multilingual TTS model' },
  eleven_multilingual_v2: {
    description: 'ElevenLabs Multilingual v2 — high-quality multilingual TTS',
  },
  eleven_flash_v2_5: { description: 'ElevenLabs Flash v2.5 — low-latency TTS' },
  eleven_flash_v2: { description: 'ElevenLabs Flash v2 — low-latency TTS' },
  eleven_turbo_v2_5: { description: 'ElevenLabs Turbo v2.5 — fast high-quality TTS' },
  eleven_turbo_v2: { description: 'ElevenLabs Turbo v2 — fast TTS' },
  eleven_monolingual_v1: { description: 'ElevenLabs Monolingual v1 — English-only TTS' },
  eleven_multilingual_v1: { description: 'ElevenLabs Multilingual v1 — multilingual TTS' },
  // Transcription (STT)
  scribe_v1: { description: 'Scribe v1 — speech-to-text transcription' },
  scribe_v1_experimental: { description: 'Scribe v1 Experimental — experimental STT' },
};
