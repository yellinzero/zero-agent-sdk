/**
 * Shared schema utilities for MCP tools.
 * Provides a Zod-like schema wrapper for MCP JSON schemas with basic validation.
 *
 * This is a lightweight JSON Schema validator that checks:
 * - Required fields exist
 * - Field types match (string, number, boolean, object, array)
 * - Input is an object when schema.type is 'object'
 *
 * It does NOT validate nested schemas, pattern matching, min/max, etc.
 * For full JSON Schema validation, users should add ajv as a dependency.
 */

// ---------------------------------------------------------------------------
// Lightweight JSON Schema validation
// ---------------------------------------------------------------------------

interface JSONSchemaObject {
  type?: string;
  properties?: Record<string, { type?: string | string[] }>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Validate input against a JSON Schema (basic checks only).
 * Returns an array of error messages. Empty array = valid.
 */
function validateAgainstSchema(input: unknown, schema: JSONSchemaObject): string[] {
  const errors: string[] = [];

  // Must be an object if schema says so
  if (schema.type === 'object') {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      errors.push('Expected an object');
      return errors;
    }

    const obj = input as Record<string, unknown>;

    // Check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          errors.push(`Missing required field: '${field}'`);
        }
      }
    }

    // Check property types (top-level only)
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in obj)) continue; // Skip missing optional fields
        const value = obj[key];
        if (value === undefined || value === null) continue; // Skip null/undefined

        const expectedTypes = Array.isArray(propSchema.type)
          ? propSchema.type
          : propSchema.type
            ? [propSchema.type]
            : [];

        if (expectedTypes.length > 0 && !matchesType(value, expectedTypes)) {
          errors.push(
            `Field '${key}' expected type ${expectedTypes.join('|')}, got ${typeof value}`
          );
        }
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, types: string[]): boolean {
  for (const type of types) {
    switch (type) {
      case 'string':
        if (typeof value === 'string') return true;
        break;
      case 'number':
      case 'integer':
        if (typeof value === 'number') return true;
        break;
      case 'boolean':
        if (typeof value === 'boolean') return true;
        break;
      case 'object':
        if (typeof value === 'object' && !Array.isArray(value) && value !== null) return true;
        break;
      case 'array':
        if (Array.isArray(value)) return true;
        break;
      case 'null':
        if (value === null) return true;
        break;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Schema wrapper
// ---------------------------------------------------------------------------

/**
 * Create a Zod-like schema from a JSON schema object with basic validation.
 *
 * Unlike the old passthrough implementation, this validates:
 * - Input is an object (when schema.type is 'object')
 * - Required fields are present
 * - Field types match at the top level
 */
export function createPassthroughSchema(jsonSchema: Record<string, unknown>): any {
  const schema = jsonSchema as JSONSchemaObject;

  return {
    parse: (input: unknown) => {
      const errors = validateAgainstSchema(input, schema);
      if (errors.length > 0) {
        throw new Error(`MCP tool input validation failed: ${errors.join('; ')}`);
      }
      return input;
    },
    safeParse: (input: unknown) => {
      const errors = validateAgainstSchema(input, schema);
      if (errors.length > 0) {
        return {
          success: false as const,
          error: { message: errors.join('; ') },
        };
      }
      return { success: true as const, data: input };
    },
    _zod: { def: { typeName: 'ZodObject' } },
  };
}
