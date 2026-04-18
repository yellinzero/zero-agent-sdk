import { z } from 'zod';
import { StructuredOutputError } from '../../core/errors.js';
import { Output } from '../../core/output.js';
import { createAgentAsync } from '../../index.js';

export function requireEnv(names: string[]): boolean {
  return names.every((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.length > 0;
  });
}

export const objectSchema = z.object({
  answer: z.string(),
});

export const arrayElementSchema = z.object({
  id: z.number(),
  label: z.string(),
});

export type LiveProviderFactory = {
  create: () => any;
  model: string;
};

async function createLiveAgent(provider: any, model: string) {
  return createAgentAsync({
    provider,
    model,
    maxTurns: 4,
    maxStructuredOutputRepairs: 2,
  });
}

export async function runStructuredObject(factory: LiveProviderFactory) {
  const agent = await createLiveAgent(factory.create(), factory.model);
  return agent.run('Return a JSON object with answer="ok".', {
    output: Output.object({ schema: objectSchema }),
  });
}

export async function runStructuredArray(factory: LiveProviderFactory) {
  const agent = await createLiveAgent(factory.create(), factory.model);
  const stream = agent.stream(
    'Return exactly two items with elements=[{id:1,label:"one"},{id:2,label:"two"}].',
    {
      output: Output.array({ element: arrayElementSchema }),
    }
  );

  const elements: Array<z.infer<typeof arrayElementSchema>> = [];
  for await (const element of stream.elementStream) {
    elements.push(element as z.infer<typeof arrayElementSchema>);
  }

  return {
    output: (await stream.output) as Array<z.infer<typeof arrayElementSchema>>,
    streamedElements: elements,
  };
}

export async function runStructuredEnum(factory: LiveProviderFactory) {
  const agent = await createLiveAgent(factory.create(), factory.model);
  return agent.run('Respond with result="green".', {
    output: Output.enum({ options: ['red', 'green', 'blue'] as const }),
  });
}

export async function runStructuredJson(factory: LiveProviderFactory) {
  const agent = await createLiveAgent(factory.create(), factory.model);
  return agent.run('Return JSON with value=1 and ok=true.', {
    output: Output.json(),
  });
}

export async function runStructuredRepair(factory: LiveProviderFactory) {
  const agent = await createLiveAgent(factory.create(), factory.model);
  return agent.run(
    'First try an invalid shape with answer as a number, then correct yourself and return answer="ok".',
    {
      output: Output.object({ schema: objectSchema }),
    }
  );
}

export async function runStructuredAbort(factory: LiveProviderFactory) {
  const agent = await createLiveAgent(factory.create(), factory.model);
  const controller = new AbortController();
  const stream = agent.stream('Produce a long JSON array slowly. Do not finish immediately.', {
    output: Output.array({ element: arrayElementSchema }),
    signal: controller.signal,
  });

  controller.abort(new Error('live abort'));

  try {
    await stream.output;
    return { aborted: false };
  } catch (error) {
    return { aborted: true, error };
  }
}

export async function runStructuredMixedText(factory: LiveProviderFactory) {
  const agent = await createLiveAgent(factory.create(), factory.model);
  return agent.run(
    'Reply with a short prose preface and then a JSON object containing answer="ok".',
    {
      output: Output.object({ schema: objectSchema }),
    }
  );
}

export function expectRepairLikeSuccess(result: { output: z.infer<typeof objectSchema> }) {
  if (result.output.answer !== 'ok') {
    throw new StructuredOutputError(
      'Repair scenario did not converge to answer="ok".',
      'schema_mismatch'
    );
  }
}
