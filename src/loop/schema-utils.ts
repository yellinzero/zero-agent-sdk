import { z } from 'zod';
import type { ResponseFormatDialect } from '../providers/types.js';

const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();

/**
 * Convert a Zod schema to a canonical JSON Schema (Draft 2020-12).
 *
 * Draft 2020-12 is the default Zod 4 emits and the only form OpenAI's strict
 * `response_format: json_schema` accepts — nullable fields render as
 * `anyOf: [T, { type: "null" }]` rather than OpenAPI-3.0's `nullable: true`.
 * Per-provider dialect tweaks (including translating back to `nullable` for
 * Gemini) live in `normalizeForProvider`.
 *
 * `$schema` is stripped because most providers reject the keyword inside
 * `response_format.json_schema.schema` / tool `parameters`.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  let cached = schemaCache.get(schema);
  if (cached) return cached;
  cached = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  delete cached.$schema;
  schemaCache.set(schema, cached);
  return cached;
}

const OPENAI_ALLOWED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
  'uri',
  'uri-reference',
  'json-pointer',
  'regex',
]);

const GEMINI_ALLOWED_FORMATS = new Set([
  'date-time',
  'date',
  'time',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
  'uri',
]);

export function normalizeForProvider(
  schema: Record<string, unknown>,
  dialect: ResponseFormatDialect
): Record<string, unknown> {
  switch (dialect) {
    case 'standard':
      return normalizeObjectTree(cloneSchema(schema), {
        formatWhitelist: null,
        expandRefs: false,
        collapseDiscriminatedUnions: false,
        rewriteOneOf: false,
        nullableMode: 'anyOf',
      });
    case 'openai-strict':
      return normalizeObjectTree(cloneSchema(schema), {
        formatWhitelist: OPENAI_ALLOWED_FORMATS,
        expandRefs: false,
        collapseDiscriminatedUnions: true,
        rewriteOneOf: false,
        nullableMode: 'anyOf',
      });
    case 'gemini':
      return normalizeObjectTree(expandLocalRefs(cloneSchema(schema)), {
        formatWhitelist: GEMINI_ALLOWED_FORMATS,
        expandRefs: true,
        collapseDiscriminatedUnions: true,
        rewriteOneOf: true,
        nullableMode: 'nullable',
      });
    case 'anthropic':
      return normalizeObjectTree(cloneSchema(schema), {
        formatWhitelist: OPENAI_ALLOWED_FORMATS,
        expandRefs: false,
        collapseDiscriminatedUnions: false,
        rewriteOneOf: false,
        nullableMode: 'anyOf',
      });
  }
}

function cloneSchema<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

interface NormalizeOptions {
  /** Allowed `format` values; `null` means keep all. */
  formatWhitelist: Set<string> | null;
  expandRefs: boolean;
  collapseDiscriminatedUnions: boolean;
  rewriteOneOf: boolean;
  /**
   * How nullable fields should be represented on the wire:
   * - `anyOf` — canonical Draft 2020-12 form `{ anyOf: [T, { type: "null" }] }`;
   *   any incoming `{ type: T, nullable: true }` is expanded into this shape.
   * - `nullable` — OpenAPI 3.0 / Gemini Schema form `{ type: T, nullable: true }`;
   *   any incoming `{ anyOf: [T, { type: "null" }] }` is collapsed into this shape.
   */
  nullableMode: 'anyOf' | 'nullable';
}

function normalizeObjectTree(
  schema: Record<string, unknown>,
  options: NormalizeOptions
): Record<string, unknown> {
  return normalizeNode(schema, options) as Record<string, unknown>;
}

function normalizeNode(node: unknown, options: NormalizeOptions): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => normalizeNode(item, options));
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  const input = node as Record<string, unknown>;

  const rewritten = applyNullableMode(input, options);
  if (rewritten !== input) return rewritten;

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if ((key === '$defs' || key === 'definitions') && options.expandRefs) continue;
    if (key === '$ref' && options.expandRefs) continue;
    if (
      key === 'format' &&
      typeof value === 'string' &&
      options.formatWhitelist !== null &&
      !options.formatWhitelist.has(value)
    ) {
      continue;
    }

    if ((key === 'oneOf' || key === 'anyOf') && Array.isArray(value)) {
      const normalizedVariants = value
        .map((variant) => normalizeNode(variant, options))
        .filter(
          (variant): variant is Record<string, unknown> => !!variant && typeof variant === 'object'
        );

      if (
        key === 'oneOf' &&
        options.collapseDiscriminatedUnions &&
        options.rewriteOneOf &&
        normalizedVariants.length > 0
      ) {
        out.anyOf = normalizedVariants;
        const requiredIntersection = intersectRequiredFields(normalizedVariants);
        if (requiredIntersection.length > 0 && out.required === undefined) {
          out.required = requiredIntersection;
        }
      } else {
        out[key] = normalizedVariants;
      }
      continue;
    }

    if (key === 'allOf' && Array.isArray(value)) {
      out.allOf = value.map((variant) => normalizeNode(variant, options));
      continue;
    }

    out[key] = normalizeNode(value, options);
  }

  return out;
}

/**
 * Translate between the two nullable representations allowed by JSON Schema
 * and OpenAPI 3.0. Returns a new node when a rewrite is performed, otherwise
 * the original reference so the caller knows to continue normal traversal.
 */
function applyNullableMode(
  node: Record<string, unknown>,
  options: NormalizeOptions
): Record<string, unknown> {
  if (options.nullableMode === 'anyOf') {
    const expanded = expandLegacyNullable(node);
    if (expanded !== node) return normalizeNode(expanded, options) as Record<string, unknown>;
    return node;
  }

  const collapsed = collapseAnyOfNull(node);
  if (collapsed !== node) return normalizeNode(collapsed, options) as Record<string, unknown>;
  return node;
}

function expandLegacyNullable(node: Record<string, unknown>): Record<string, unknown> {
  if (node.nullable !== true) return node;

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'nullable') continue;
    rest[key] = value;
  }

  const existingAnyOf = Array.isArray(rest.anyOf) ? (rest.anyOf as unknown[]) : undefined;
  if (existingAnyOf) {
    if (
      !existingAnyOf.some(
        (variant) => isObject(variant) && (variant as Record<string, unknown>).type === 'null'
      )
    ) {
      rest.anyOf = [...existingAnyOf, { type: 'null' }];
    }
    return rest;
  }

  const existingOneOf = Array.isArray(rest.oneOf) ? (rest.oneOf as unknown[]) : undefined;
  if (existingOneOf) {
    if (
      !existingOneOf.some(
        (variant) => isObject(variant) && (variant as Record<string, unknown>).type === 'null'
      )
    ) {
      rest.oneOf = [...existingOneOf, { type: 'null' }];
    }
    return rest;
  }

  return { anyOf: [rest, { type: 'null' }] };
}

function collapseAnyOfNull(node: Record<string, unknown>): Record<string, unknown> {
  const anyOf = node.anyOf;
  if (!Array.isArray(anyOf) || anyOf.length !== 2) return node;

  const nullIndex = anyOf.findIndex(
    (variant) => isObject(variant) && Object.keys(variant).length === 1 && variant.type === 'null'
  );
  if (nullIndex === -1) return node;
  const other = anyOf[1 - nullIndex];
  if (!isObject(other)) return node;

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'anyOf') continue;
    rest[key] = value;
  }

  return { ...other, ...rest, nullable: true };
}

function intersectRequiredFields(variants: Record<string, unknown>[]): string[] {
  if (!isDiscriminatedUnion(variants)) return [];

  const requiredSets = variants
    .map((variant) =>
      Array.isArray(variant.required)
        ? new Set(
            (variant.required as unknown[]).filter(
              (item): item is string => typeof item === 'string'
            )
          )
        : null
    )
    .filter((set): set is Set<string> => set !== null);

  if (requiredSets.length === 0) return [];

  const intersection = new Set(requiredSets[0]);
  for (const set of requiredSets.slice(1)) {
    for (const value of [...intersection]) {
      if (!set.has(value)) intersection.delete(value);
    }
  }
  return [...intersection];
}

function expandLocalRefs(schema: Record<string, unknown>, maxDepth = 8): Record<string, unknown> {
  const defs = {
    ...(isObject(schema.$defs) ? schema.$defs : {}),
    ...(isObject(schema.definitions) ? schema.definitions : {}),
  };

  const expand = (node: unknown, depth: number, seen: Set<string>): unknown => {
    if (depth > maxDepth) {
      throw new Error(
        `Schema too deeply nested for provider normalization (maxDepth=${maxDepth}).`
      );
    }
    if (Array.isArray(node)) return node.map((item) => expand(item, depth + 1, seen));
    if (!node || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const ref = typeof obj.$ref === 'string' ? obj.$ref : undefined;
    if (ref?.startsWith('#/$defs/') || ref?.startsWith('#/definitions/')) {
      const key = ref.split('/').pop() ?? '';
      const target = defs[key];
      if (!target || seen.has(ref)) {
        return Object.fromEntries(Object.entries(obj).filter(([entryKey]) => entryKey !== '$ref'));
      }
      return expand(target, depth + 1, new Set([...seen, ref]));
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$defs' || key === 'definitions') continue;
      out[key] = expand(value, depth + 1, seen);
    }
    return out;
  };

  return expand(schema, 0, new Set()) as Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDiscriminatedUnion(variants: Record<string, unknown>[]): boolean {
  const propertySets = variants.map((variant) =>
    isObject(variant.properties) ? variant.properties : undefined
  );
  const candidateKeys = new Set<string>();
  for (const props of propertySets) {
    if (!props) return false;
    for (const key of Object.keys(props)) candidateKeys.add(key);
  }

  for (const key of candidateKeys) {
    const enumValues = variants.map((variant) => {
      const props = isObject(variant.properties) ? variant.properties : undefined;
      const property = props?.[key];
      if (!isObject(property)) return undefined;
      if (Array.isArray(property.enum) && property.enum.length === 1) {
        return property.enum[0];
      }
      if ('const' in property) return property.const;
      return undefined;
    });

    if (enumValues.every((value) => value !== undefined)) {
      const unique = new Set(enumValues.map((value) => JSON.stringify(value)));
      if (unique.size === enumValues.length) return true;
    }
  }

  return false;
}
