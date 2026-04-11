import type {
  ModelWarning,
  ResponseMeta,
  TranscriptionModel,
  TranscriptionModelCallOptions,
  TranscriptionModelResult,
  TranscriptionSegment,
} from '../multimodal.js';

/** Configuration for the AssemblyAI provider. */
export interface AssemblyAIConfig {
  /** AssemblyAI API key. Defaults to `ASSEMBLYAI_API_KEY` env var. */
  apiKey?: string;
  /** Base URL for API calls. Defaults to `https://api.assemblyai.com`. */
  baseUrl?: string;
  /** Extra headers to include in every request. */
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://api.assemblyai.com';
const POLL_INTERVAL_MS = 3000;

function resolveApiKey(config?: AssemblyAIConfig): string {
  const key = config?.apiKey ?? process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    throw new Error(
      'AssemblyAI: API key is required. Set `apiKey` in config or the ASSEMBLYAI_API_KEY environment variable.'
    );
  }
  return key;
}

function getBaseHeaders(config?: AssemblyAIConfig): Record<string, string> {
  return {
    Authorization: resolveApiKey(config),
    ...config?.headers,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('AssemblyAI: request aborted'));
      },
      { once: true }
    );
  });
}

/**
 * AssemblyAI transcription model.
 *
 * Uses an async workflow: upload audio, submit transcript job, poll for result.
 * @see https://www.assemblyai.com/docs/api-reference/transcripts
 */
export class AssemblyAITranscriptionModel implements TranscriptionModel {
  readonly providerId = 'assemblyai';

  constructor(
    readonly modelId: string,
    private readonly config?: AssemblyAIConfig
  ) {}

  async doGenerate(options: TranscriptionModelCallOptions): Promise<TranscriptionModelResult> {
    const baseUrl = (this.config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const warnings: ModelWarning[] = [];
    const headers = { ...getBaseHeaders(this.config), ...options.headers };

    // Step 1: Upload audio
    const audioData =
      options.audio instanceof Uint8Array ? options.audio : new TextEncoder().encode(options.audio);

    const uploadRes = await fetch(`${baseUrl}/v2/upload`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: audioData,
      signal: options.signal,
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => '');
      throw new Error(`AssemblyAI: upload failed (${uploadRes.status}): ${errBody}`);
    }

    const uploadData = (await uploadRes.json()) as { upload_url: string };

    // Step 2: Submit transcript job
    const transcriptBody: Record<string, unknown> = {
      audio_url: uploadData.upload_url,
      speech_model: this.modelId,
    };

    // Pass through provider options
    if (options.providerOptions) {
      for (const [key, value] of Object.entries(options.providerOptions)) {
        if (value !== undefined && value !== null) {
          transcriptBody[key] = value;
        }
      }
    }

    const submitRes = await fetch(`${baseUrl}/v2/transcript`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(transcriptBody),
      signal: options.signal,
    });

    if (!submitRes.ok) {
      const errBody = await submitRes.text().catch(() => '');
      throw new Error(`AssemblyAI: submit failed (${submitRes.status}): ${errBody}`);
    }

    const submitData = (await submitRes.json()) as { id: string; status: string };

    // Step 3: Poll for completion
    while (true) {
      await delay(POLL_INTERVAL_MS, options.signal);

      const pollRes = await fetch(`${baseUrl}/v2/transcript/${submitData.id}`, {
        method: 'GET',
        headers,
        signal: options.signal,
      });

      if (!pollRes.ok) {
        const errBody = await pollRes.text().catch(() => '');
        throw new Error(`AssemblyAI: poll failed (${pollRes.status}): ${errBody}`);
      }

      const pollData = (await pollRes.json()) as {
        status: string;
        text?: string;
        language_code?: string;
        audio_duration?: number;
        error?: string;
        words?: Array<{ text: string; start: number; end: number }>;
      };

      if (pollData.status === 'completed') {
        const segments: TranscriptionSegment[] =
          pollData.words?.map((w) => ({
            text: w.text,
            startSecond: w.start / 1000,
            endSecond: w.end / 1000,
          })) ?? [];

        const response: ResponseMeta = {
          timestamp: new Date(),
          modelId: this.modelId,
          headers: Object.fromEntries(pollRes.headers.entries()),
        };

        return {
          text: pollData.text ?? '',
          segments,
          language: pollData.language_code,
          durationInSeconds: pollData.audio_duration,
          warnings,
          response,
        };
      }

      if (pollData.status === 'error') {
        throw new Error(`AssemblyAI: transcription failed: ${pollData.error ?? 'Unknown error'}`);
      }

      // Continue polling for 'queued' / 'processing'
    }
  }
}

/**
 * Create an AssemblyAI provider instance.
 *
 * @example
 * ```ts
 * const assemblyai = createAssemblyAI({ apiKey: 'your-key' });
 * const model = assemblyai.transcription('best');
 * ```
 */
export function createAssemblyAI(config?: AssemblyAIConfig) {
  return {
    /** Create a transcription model. */
    transcription: (modelId: string) => new AssemblyAITranscriptionModel(modelId, config),
  };
}
