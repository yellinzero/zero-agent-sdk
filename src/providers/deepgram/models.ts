/**
 * Deepgram speech and transcription model catalog.
 *
 * @see https://developers.deepgram.com
 */
export const DEEPGRAM_MODELS: Record<string, { description: string }> = {
  // Speech (TTS)
  'aura-asteria-en': { description: 'Aura Asteria — English female voice' },
  'aura-2-asteria-en': { description: 'Aura 2 Asteria — English female voice' },
  'aura-2-thalia-en': { description: 'Aura 2 Thalia — English female voice' },
  'aura-2-helena-en': { description: 'Aura 2 Helena — English female voice' },
  'aura-2-orpheus-en': { description: 'Aura 2 Orpheus — English male voice' },
  'aura-2-zeus-en': { description: 'Aura 2 Zeus — English male voice' },
  'aura-luna-en': { description: 'Aura Luna — English female voice' },
  'aura-stella-en': { description: 'Aura Stella — English female voice' },
  // Transcription (STT)
  'nova-3': { description: 'Nova 3 — latest general-purpose STT model' },
  'nova-3-general': { description: 'Nova 3 General — general-purpose STT' },
  'nova-3-medical': { description: 'Nova 3 Medical — medical domain STT' },
  'nova-2': { description: 'Nova 2 — general-purpose STT model' },
  'nova-2-general': { description: 'Nova 2 General — general-purpose STT' },
  'nova-2-meeting': { description: 'Nova 2 Meeting — meeting transcription' },
  'nova-2-phonecall': { description: 'Nova 2 Phonecall — phone call transcription' },
  'nova-2-medical': { description: 'Nova 2 Medical — medical domain STT' },
};
