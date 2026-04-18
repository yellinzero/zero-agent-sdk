/**
 * Output — the canonical structured-output abstraction.
 *
 * Each `OutputDefinition` describes (a) the wire-format the provider should
 * emit, (b) how to parse partial JSON during streaming, (c) how to parse and
 * validate the final value, and (d) how to validate an already-parsed value
 * (used by the tool-synthesis fallback).
 */

import type { z } from 'zod';
import { zodToJsonSchema } from '../loop/schema-utils.js';
import type { ResponseFormat } from '../providers/types.js';
import { findJsonSlice } from '../utils/json-slice.js';
import { parsePartialJson } from '../utils/partial-json.js';
import type { DeepPartial } from './types.js';

export type OutputKind = 'text' | 'object' | 'array' | 'enum' | 'json';

/**
 * Result of incrementally parsing a partial output stream.
 *
 * - `partial` is the best-effort interpretation of everything seen so far.
 *   May be `undefined` when the stream isn't far enough along to be useful.
 * - `elements` is populated only by array outputs and contains fully-parsed
 *   elements (the in-progress final element is intentionally excluded).
 */
export interface PartialParseResult<TPartial, TElement = never> {
  partial?: TPartial;
  elements?: TElement[];
}

export interface ParseFinalContext {
  finishReason?: string;
}

export interface OutputDefinition<TFinal = unknown, TPartial = TFinal, TElement = never> {
  readonly kind: OutputKind;
  readonly responseFormat: ResponseFormat;
  parsePartial(text: string): PartialParseResult<TPartial, TElement>;
  parseFinal(text: string, context?: ParseFinalContext): TFinal;
  /**
   * Validate an already-parsed value. Used by the tool-synthesis path where
   * the model emits a tool call whose input is the structured object — no
   * intermediate JSON text is involved. Throws on validation failure.
   */
  validate(value: unknown): TFinal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJsonFromText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence?.[1]) return fence[1].trim();
  }
  return findJsonSlice(trimmed) ?? trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Format a Zod validation error as a compact, model-friendly message suitable
 * for feeding back into the agent loop during structured-output repair.
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Output factory
// ---------------------------------------------------------------------------

export const Output = {
  /** Plain text — the default mode when no `output` is supplied. */
  text(): OutputDefinition<string, string> {
    return {
      kind: 'text',
      responseFormat: { type: 'text' },
      parsePartial: (text) => (text ? { partial: text } : {}),
      parseFinal: (text) => text,
      validate: (value) => {
        if (typeof value !== 'string') {
          throw new Error(`Text output expected a string, got ${typeof value}.`);
        }
        return value;
      },
    };
  },

  /**
   * Strict structured object validated by the supplied Zod schema.
   * Provider receives a `json_schema` response format derived from the schema.
   */
  object<TSchema extends z.ZodType>(options: {
    schema: TSchema;
    name?: string;
    description?: string;
    strict?: boolean;
  }): OutputDefinition<z.infer<TSchema>, DeepPartial<z.infer<TSchema>>> {
    const jsonSchema = zodToJsonSchema(options.schema);
    return {
      kind: 'object',
      responseFormat: {
        type: 'json_schema',
        name: options.name ?? 'response',
        description: options.description,
        strict: options.strict,
        schema: jsonSchema,
      },
      parsePartial: (text) => {
        if (!text.trim()) return {};
        const value = parsePartialJson(extractJsonFromText(text));
        if (!isPlainObject(value)) return {};
        return { partial: value as DeepPartial<z.infer<TSchema>> };
      },
      parseFinal: (text) => {
        const cleaned = extractJsonFromText(text);
        const raw = JSON.parse(cleaned);
        return options.schema.parse(raw);
      },
      validate: (value) => options.schema.parse(value),
    };
  },

  /**
   * Array of items. Each element is validated individually so partial streams
   * can yield completed elements via `elementStream`.
   *
   * The wire schema is a wrapper object `{ elements: <items>[] }` so the model
   * can stream JSON deterministically. Missing or non-array `elements` is
   * treated as a structured-output failure (no silent empty-array fallback).
   */
  array<TSchema extends z.ZodType>(options: {
    element: TSchema;
    name?: string;
    description?: string;
    strict?: boolean;
  }): OutputDefinition<z.infer<TSchema>[], z.infer<TSchema>[], z.infer<TSchema>> {
    const elementJsonSchema = zodToJsonSchema(options.element);
    const wrapperSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        elements: { type: 'array', items: elementJsonSchema },
      },
      required: ['elements'],
      additionalProperties: false,
    };
    const arraySchema = options.element.array();
    return {
      kind: 'array',
      responseFormat: {
        type: 'json_schema',
        name: options.name ?? 'response',
        description: options.description,
        strict: options.strict,
        schema: wrapperSchema,
      },
      parsePartial: (text) => {
        if (!text.trim()) return {};
        const value = parsePartialJson(extractJsonFromText(text));
        if (!isPlainObject(value)) return {};
        const elements = value.elements;
        if (!Array.isArray(elements)) return {};

        // Validate each element individually; drop invalid ones from the
        // emitted partial (they may be mid-stream). The final element is
        // excluded from `elements` because it may still be growing.
        const completed: z.infer<TSchema>[] = [];
        const upperBound = Math.max(0, elements.length - 1);
        for (let i = 0; i < upperBound; i++) {
          const parsed = options.element.safeParse(elements[i]);
          if (parsed.success) completed.push(parsed.data);
        }

        const partial: z.infer<TSchema>[] = [...completed];
        if (elements.length > 0) {
          const tailParse = options.element.safeParse(elements[elements.length - 1]);
          if (tailParse.success) partial.push(tailParse.data);
        }
        return { partial, elements: completed };
      },
      parseFinal: (text) => {
        const cleaned = extractJsonFromText(text);
        const raw = JSON.parse(cleaned);
        if (!isPlainObject(raw) || !Array.isArray(raw.elements)) {
          throw new Error(
            `Array output requires a top-level array; got ${raw === null ? 'null' : typeof raw}.`
          );
        }
        return arraySchema.parse(raw.elements);
      },
      validate: (value) => {
        if (!isPlainObject(value) || !Array.isArray(value.elements)) {
          throw new Error('Array output requires a top-level array.');
        }
        return arraySchema.parse(value.elements);
      },
    };
  },

  /**
   * Restricted enum-like result selected from a fixed list of strings.
   * The wire schema is `{ result: <enum> }` so the response format remains a
   * valid JSON object across providers.
   */
  enum<const TChoices extends readonly [string, ...string[]]>(options: {
    options: TChoices;
    name?: string;
    description?: string;
  }): OutputDefinition<TChoices[number], TChoices[number]> {
    const allowed = new Set<string>(options.options);
    return {
      kind: 'enum',
      responseFormat: {
        type: 'json_schema',
        name: options.name ?? 'response',
        description: options.description,
        schema: {
          type: 'object',
          properties: {
            result: { type: 'string', enum: [...options.options] },
          },
          required: ['result'],
          additionalProperties: false,
        },
      },
      parsePartial: (text) => {
        if (!text.trim()) return {};
        const value = parsePartialJson(extractJsonFromText(text));
        if (!isPlainObject(value)) return {};
        const result = value.result;
        if (typeof result !== 'string') return {};
        // Avoid premature emission on prefix ambiguity ("sun" → "sunny" vs "sundown").
        if (!allowed.has(result)) {
          const candidates = [...allowed].filter((opt) => opt.startsWith(result));
          if (candidates.length !== 1) return {};
          return { partial: candidates[0] as TChoices[number] };
        }
        return { partial: result as TChoices[number] };
      },
      parseFinal: (text) => {
        const cleaned = extractJsonFromText(text);
        const raw = JSON.parse(cleaned);
        if (!isPlainObject(raw) || typeof raw.result !== 'string' || !allowed.has(raw.result)) {
          throw new Error(`Enum output expected { result: <one of ${[...allowed].join(' | ')}> }.`);
        }
        return raw.result as TChoices[number];
      },
      validate: (value) => {
        if (
          !isPlainObject(value) ||
          typeof value.result !== 'string' ||
          !allowed.has(value.result)
        ) {
          throw new Error(`Enum output expected { result: <one of ${[...allowed].join(' | ')}> }.`);
        }
        return value.result as TChoices[number];
      },
    };
  },

  /**
   * Free-form JSON **object**. No schema validation is performed, but the
   * value is enforced to be a JSON object (not an array, string, number,
   * boolean, or null).
   *
   * This constraint exists because the wire format (`json_object`) and the
   * tool-synthesis fallback both require an object shape — most providers
   * reject non-object response formats and tool inputs. Callers that need a
   * specific schema should use `Output.object` with a Zod schema; callers
   * that want a top-level array should use `Output.array`.
   */
  json(): OutputDefinition<Record<string, unknown>, Record<string, unknown>> {
    return {
      kind: 'json',
      responseFormat: { type: 'json_object' },
      parsePartial: (text) => {
        if (!text.trim()) return {};
        const value = parsePartialJson(extractJsonFromText(text));
        if (!isPlainObject(value)) return {};
        return { partial: value };
      },
      parseFinal: (text) => {
        const cleaned = extractJsonFromText(text);
        const raw = JSON.parse(cleaned);
        if (!isPlainObject(raw)) {
          throw new Error(
            `Output.json expected a JSON object; got ${raw === null ? 'null' : typeof raw}. ` +
              `Use Output.object or Output.array for non-object shapes.`
          );
        }
        return raw;
      },
      validate: (value) => {
        if (!isPlainObject(value)) {
          throw new Error(
            `Output.json expected a JSON object; got ${value === null ? 'null' : typeof value}. ` +
              `Use Output.object or Output.array for non-object shapes.`
          );
        }
        return value;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Type inference helpers
// ---------------------------------------------------------------------------

export type InferOutputResult<TOutput> =
  TOutput extends OutputDefinition<infer TResult, any, any> ? TResult : never;

export type InferOutputPartial<TOutput> =
  TOutput extends OutputDefinition<any, infer TPartial, any> ? TPartial : never;

export type InferOutputElement<TOutput> =
  TOutput extends OutputDefinition<any, any, infer TElement> ? TElement : never;
