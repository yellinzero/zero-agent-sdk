import { describe, expect, it } from 'vitest';
import { normalizeForProvider } from '../loop/schema-utils.js';

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
