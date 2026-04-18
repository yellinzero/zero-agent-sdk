import { describe, expect, it } from 'vitest';
import { bedrock } from '../../../src/providers/amazon-bedrock/index.js';
import { anthropic } from '../../../src/providers/anthropic/index.js';
import { deepseek } from '../../../src/providers/deepseek/index.js';
import { google } from '../../../src/providers/google/index.js';
import { openResponses } from '../../../src/providers/open-responses/index.js';
import { openai } from '../../../src/providers/openai/index.js';
import {
  expectRepairLikeSuccess,
  type LiveProviderFactory,
  requireEnv,
  runStructuredAbort,
  runStructuredArray,
  runStructuredEnum,
  runStructuredJson,
  runStructuredMixedText,
  runStructuredObject,
  runStructuredRepair,
} from './helpers.js';

const RUNS_PER_PROVIDER = 3;

describe('live structured output matrix', () => {
  const providers: Array<
    LiveProviderFactory & {
      name: string;
      enabled: boolean;
    }
  > = [
    {
      name: 'openai',
      enabled: requireEnv(['OPENAI_API_KEY']),
      create: () => openai(),
      model: process.env.OPENAI_LIVE_MODEL ?? 'gpt-4o-mini',
    },
    {
      name: 'anthropic',
      enabled: requireEnv(['ANTHROPIC_API_KEY']),
      create: () => anthropic(),
      model: process.env.ANTHROPIC_LIVE_MODEL ?? 'claude-sonnet-4-6',
    },
    {
      name: 'google',
      enabled: requireEnv(['GOOGLE_API_KEY']),
      create: () => google(),
      model: process.env.GOOGLE_LIVE_MODEL ?? 'gemini-2.5-flash',
    },
    {
      name: 'bedrock',
      // Bedrock needs a region AND credentials. AWS_REGION alone would
      // turn skipped runs into runtime failures.
      enabled: requireEnv(['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']),
      create: () => bedrock(),
      model: process.env.BEDROCK_LIVE_MODEL ?? 'amazon.nova-pro-v1:0',
    },
    {
      name: 'deepseek',
      enabled: requireEnv(['DEEPSEEK_API_KEY']),
      create: () => deepseek(),
      model: process.env.DEEPSEEK_LIVE_MODEL ?? 'deepseek-chat',
    },
    {
      // Open Responses API — proxied OpenAI-compatible /v1/responses endpoint.
      // Driven by AI_BASE_URL / AI_API_KEY / AI_MODEL so any compatible
      // gateway (e.g. an internal LLM proxy) can be exercised.
      name: 'open-responses',
      enabled: requireEnv(['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL']),
      create: () =>
        openResponses({
          name: 'open-responses',
          url: `${(process.env.AI_BASE_URL ?? '').replace(/\/$/, '')}/responses`,
          apiKey: process.env.AI_API_KEY,
        }),
      model: process.env.AI_MODEL ?? 'gpt-4o-mini',
    },
  ];

  for (const providerDef of providers) {
    const liveIt = providerDef.enabled ? it : it.skip;

    liveIt(`${providerDef.name} object succeeds ${RUNS_PER_PROVIDER} times`, async () => {
      for (let i = 0; i < RUNS_PER_PROVIDER; i++) {
        const result = await runStructuredObject(providerDef);
        expect(result.output.answer).toBe('ok');
      }
    });

    liveIt(`${providerDef.name} array streams elements`, async () => {
      const result = await runStructuredArray(providerDef);
      expect(result.output).toHaveLength(2);
      expect(result.output[0]?.id).toBe(1);
      expect(result.streamedElements.length).toBeGreaterThanOrEqual(1);
    });

    liveIt(`${providerDef.name} enum returns an allowed value`, async () => {
      const result = await runStructuredEnum(providerDef);
      expect(['red', 'green', 'blue']).toContain(result.output);
    });

    liveIt(`${providerDef.name} Output.json returns arbitrary JSON`, async () => {
      const result = await runStructuredJson(providerDef);
      expect(result.output).toMatchObject({ value: 1, ok: true });
    });

    liveIt(`${providerDef.name} repair converges to a valid object`, async () => {
      const result = await runStructuredRepair(providerDef);
      expectRepairLikeSuccess(result);
    });

    liveIt(`${providerDef.name} abort rejects the structured stream`, async () => {
      const result = await runStructuredAbort(providerDef);
      expect(result.aborted).toBe(true);
    });

    liveIt(`${providerDef.name} mixed prose plus JSON still parses`, async () => {
      const result = await runStructuredMixedText(providerDef);
      // Synthesis-path providers force a single tool call, so the model may
      // stuff its prose preface into the schema field. Native-path providers
      // can emit prose alongside JSON which we then slice. Either way, the
      // schema must validate and the answer must mention 'ok'.
      expect(typeof result.output.answer).toBe('string');
      expect(result.output.answer.toLowerCase()).toContain('ok');
    });
  }
});
