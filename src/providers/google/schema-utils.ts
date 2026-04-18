import { normalizeForProvider } from '../../loop/schema-utils.js';

export function jsonSchemaToGemini(schema: unknown): Record<string, unknown> {
  if (schema == null || typeof schema !== 'object') {
    return {};
  }
  return normalizeForProvider(schema as Record<string, unknown>, 'gemini');
}
