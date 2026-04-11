/**
 * Provider error mapping — converts SDK-specific errors into structured ProviderError
 * with HTTP status codes for reliable retry classification.
 */

import { ProviderError } from '../../core/errors.js';

const NETWORK_STATUS_MAP: Record<string, number> = {
  ECONNRESET: 503,
  EPIPE: 503,
  ETIMEDOUT: 408,
  ECONNREFUSED: 503,
  ENOTFOUND: 503,
  EAI_AGAIN: 503,
};

/**
 * Map a raw provider SDK error into a structured ProviderError with a status code.
 * Supports Anthropic SDK, OpenAI SDK, and common network errors.
 */
export function mapProviderError(error: unknown, providerId: string): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof Error) {
    // Anthropic SDK — error.status is a direct property
    if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
      return new ProviderError(
        error.message,
        (error as { status: number }).status,
        providerId,
        error
      );
    }

    // OpenAI SDK — error.response?.status
    if ('response' in error) {
      const resp = (error as { response?: { status?: number } }).response;
      if (resp && typeof resp.status === 'number') {
        return new ProviderError(error.message, resp.status, providerId, error);
      }
    }

    // Network errors (ECONNRESET, EPIPE, etc.)
    if ('code' in error) {
      const code = (error as { code: string }).code;
      const status = NETWORK_STATUS_MAP[code];
      if (status) {
        return new ProviderError(error.message, status, providerId, error);
      }
    }

    return new ProviderError(error.message, undefined, providerId, error);
  }

  return new ProviderError(String(error), undefined, providerId);
}
