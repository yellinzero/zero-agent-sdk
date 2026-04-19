import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeForProvider, zodToJsonSchema } from '../loop/schema-utils.js';

describe('schema normalization', () => {
  it('preserves oneOf for openai-strict dialect', () => {
    const schema = {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: { kind: { const: 'a' }, value: { type: 'string' } },
          required: ['kind', 'value'],
        },
        {
          type: 'object',
          properties: { kind: { const: 'b' }, count: { type: 'number' } },
          required: ['kind', 'count'],
        },
      ],
    };

    const normalized = normalizeForProvider(schema, 'openai-strict');
    expect(normalized.oneOf).toBeDefined();
    expect(normalized.anyOf).toBeUndefined();
  });

  it('throws when recursive local refs exceed expansion depth for gemini', () => {
    const recursive = {
      $defs: {
        node1: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node2' },
          },
        },
        node2: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node3' },
          },
        },
        node3: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node4' },
          },
        },
        node4: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node5' },
          },
        },
        node5: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node6' },
          },
        },
        node6: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node7' },
          },
        },
        node7: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node8' },
          },
        },
        node8: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node9' },
          },
        },
        node9: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/node10' },
          },
        },
        node10: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      },
      $ref: '#/$defs/node1',
    };

    expect(() => normalizeForProvider(recursive, 'gemini')).toThrow(/too deeply nested/i);
  });
});

describe('zodToJsonSchema', () => {
  it('emits Draft 2020-12 anyOf for nullable fields and strips $schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().nullable(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.$schema).toBeUndefined();
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.age).toEqual({
      anyOf: [{ type: 'number' }, { type: 'null' }],
    });
    expect(props.age.nullable).toBeUndefined();
  });

  it('caches generated schemas by Zod reference', () => {
    const schema = z.object({ id: z.string() });
    expect(zodToJsonSchema(schema)).toBe(zodToJsonSchema(schema));
  });
});

describe('nullable normalization', () => {
  it('expands legacy `nullable: true` to anyOf for openai-strict', () => {
    const schema = {
      type: 'object',
      properties: { age: { type: 'number', nullable: true } },
      required: ['age'],
      additionalProperties: false,
    };
    const normalized = normalizeForProvider(schema, 'openai-strict');
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.age).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
    expect(props.age.nullable).toBeUndefined();
  });

  it('expands legacy `nullable: true` to anyOf for anthropic', () => {
    const schema = {
      type: 'object',
      properties: { title: { type: 'string', nullable: true, description: 'label' } },
    };
    const normalized = normalizeForProvider(schema, 'anthropic');
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.title).toEqual({
      anyOf: [{ type: 'string', description: 'label' }, { type: 'null' }],
    });
  });

  it('leaves existing Draft 2020-12 anyOf intact for openai-strict', () => {
    const schema = {
      type: 'object',
      properties: {
        bio: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    };
    const normalized = normalizeForProvider(schema, 'openai-strict');
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.bio).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(JSON.stringify(normalized)).not.toContain('"nullable":true');
  });

  it('collapses anyOf-with-null to OpenAPI `nullable: true` for gemini', () => {
    const schema = {
      type: 'object',
      properties: {
        age: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      },
    };
    const normalized = normalizeForProvider(schema, 'gemini');
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.age).toEqual({ type: 'number', nullable: true });
  });

  it('preserves existing `nullable: true` for gemini', () => {
    const schema = {
      type: 'object',
      properties: { age: { type: 'number', nullable: true } },
    };
    const normalized = normalizeForProvider(schema, 'gemini');
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.age).toEqual({ type: 'number', nullable: true });
  });

  it('carries sibling keywords (description) through anyOf collapse for gemini', () => {
    const schema = {
      type: 'object',
      properties: {
        bio: {
          description: 'About the user',
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
      },
    };
    const normalized = normalizeForProvider(schema, 'gemini');
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.bio).toEqual({
      type: 'string',
      description: 'About the user',
      nullable: true,
    });
  });

  it('does not collapse multi-branch anyOf for gemini when no null branch', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
    };
    const normalized = normalizeForProvider(schema, 'gemini');
    const props = normalized.properties as Record<string, Record<string, unknown>>;
    expect(props.value).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
  });
});
