/**
 * WebFetch tool — fetches content from a URL and optionally summarizes it.
 * Uses native fetch. Strips HTML tags for text extraction.
 */

import { z } from 'zod';
import type { SSRFValidationResult } from '../../permissions/ssrf-guard.js';
import { validateUrl } from '../../permissions/ssrf-guard.js';
import { buildSDKTool, type SDKTool } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebFetchToolOptions {
  /** Maximum response body size in bytes (default: 5MB) */
  maxSizeBytes?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Optional function to summarize fetched content */
  summarizeFn?: (content: string, prompt: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create fetch options that pin the connection to a pre-validated IP address.
 * This prevents DNS rebinding TOCTOU attacks where a second DNS lookup
 * could resolve to a different (internal) IP after SSRF validation passed.
 */
function createPinnedFetchOptions(
  validation: SSRFValidationResult,
  baseOptions: RequestInit
): RequestInit {
  if (!validation.resolvedAddress) {
    return baseOptions;
  }

  // Use Node.js undici dispatcher to pin DNS resolution to the validated IP.
  // This requires Node.js 18+ with undici built-in.
  try {
    // Dynamic import to avoid issues in non-Node environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undici = require('undici') as any;
    const pinnedAddress = validation.resolvedAddress;
    const pinnedFamily = validation.resolvedFamily ?? 4;
    return {
      ...baseOptions,
      // dispatcher is a Node.js-specific fetch option from undici
      dispatcher: new undici.Agent({
        connect: {
          lookup: (
            _hostname: string,
            _options: unknown,
            cb: (err: Error | null, result: Array<{ address: string; family: number }>) => void
          ) => {
            cb(null, [{ address: pinnedAddress, family: pinnedFamily }]);
          },
        },
      }),
    };
  } catch {
    // undici not available — fall back to standard fetch without pinning.
    // This is acceptable in environments where DNS rebinding is not a concern
    // (e.g. browser, Deno, Bun), but leaves a TOCTOU window in Node.js
    // without undici installed separately.
    return baseOptions;
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  url: z.url().describe('The URL to fetch content from'),
  prompt: z
    .string()
    .describe('The prompt to describe what information you want to extract from the page'),
});

type WebFetchInput = z.infer<typeof inputSchema>;

interface WebFetchOutput {
  url: string;
  content: string;
  redirected?: boolean;
  redirectUrl?: string;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createWebFetchTool(
  options?: WebFetchToolOptions
): SDKTool<WebFetchInput, WebFetchOutput> {
  const maxSize = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const summarizeFn = options?.summarizeFn;

  return buildSDKTool({
    name: 'WebFetch',
    inputSchema,
    maxResultSizeChars: 50_000,

    async description() {
      return 'Fetches content from a specified URL and processes it. Takes a URL and a prompt as input, fetches the URL content, converts HTML to text, and optionally summarizes it.';
    },

    async prompt() {
      return 'Use WebFetch to retrieve and analyze web content. The URL must be a fully-formed valid URL.';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    async checkPermissions(input) {
      const result = await validateUrl(input.url);
      if (!result.allowed) {
        return { behavior: 'deny' as const, message: result.reason! };
      }
      return { behavior: 'allow' as const };
    },

    async call(input, context): Promise<{ data: WebFetchOutput }> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      // Link external abort signal so user abort / session close propagates
      const onAbort = () => controller.abort();
      context?.abortSignal?.addEventListener('abort', onAbort);

      const MAX_REDIRECTS = 10;

      try {
        let currentUrl = input.url;

        // Follow redirects manually to validate each redirect target against SSRF
        let response: Response | undefined;
        let lastValidation: SSRFValidationResult | undefined;
        for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
          // Validate URL before each request (including redirects)
          const validation = await validateUrl(currentUrl);
          if (!validation.allowed) {
            return {
              data: {
                url: input.url,
                content: `Blocked: ${validation.reason}`,
              },
            };
          }
          lastValidation = validation;

          const fetchOptions = createPinnedFetchOptions(validation, {
            signal: controller.signal,
            headers: { 'User-Agent': 'zero-agent-sdk/0.1' },
            redirect: 'manual',
          });

          response = await fetch(currentUrl, fetchOptions);

          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) break;
            currentUrl = new URL(location, currentUrl).href;
            continue;
          }

          break; // Non-redirect response — proceed to process
        }

        if (!response) {
          return { data: { url: input.url, content: 'No response received.' } };
        }

        if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) {
          return {
            data: {
              url: input.url,
              content: `HTTP ${response.status}: ${response.statusText}`,
            },
          };
        }

        // If we exhausted redirects and still got a redirect status
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          return {
            data: {
              url: input.url,
              content: `Too many redirects (exceeded ${MAX_REDIRECTS}).`,
            },
          };
        }

        const contentType = response.headers.get('content-type') ?? '';

        // Skip binary content
        if (
          contentType.includes('image/') ||
          contentType.includes('audio/') ||
          contentType.includes('video/') ||
          contentType.includes('application/octet-stream')
        ) {
          return {
            data: {
              url: input.url,
              content: `Binary content (${contentType}) — cannot extract text.`,
            },
          };
        }

        // Check for redirect
        const redirected = currentUrl !== input.url;
        const redirectUrl = redirected ? currentUrl : undefined;

        // Read body with size limit
        const reader = response.body?.getReader();
        if (!reader) {
          return { data: { url: input.url, content: 'Empty response body.' } };
        }

        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalSize += value.byteLength;
          if (totalSize > maxSize) {
            reader.cancel();
            break;
          }
          chunks.push(value);
        }

        const decoder = new TextDecoder();
        const rawText = chunks.map((c) => decoder.decode(c, { stream: true })).join('');

        // Convert HTML to text
        let text: string;
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          text = stripHtmlTags(rawText);
        } else {
          text = rawText;
        }

        // Optionally summarize
        if (summarizeFn) {
          text = await summarizeFn(text, input.prompt);
        }

        return {
          data: { url: input.url, content: text, redirected, redirectUrl },
        };
      } finally {
        clearTimeout(timeout);
        context?.abortSignal?.removeEventListener('abort', onAbort);
      }
    },

    mapToolResult(output, toolUseId) {
      const parts: string[] = [];
      if (output.redirected && output.redirectUrl) {
        parts.push(`[Redirected to: ${output.redirectUrl}]`);
      }
      parts.push(output.content);
      return { type: 'tool_result', tool_use_id: toolUseId, content: parts.join('\n') };
    },
  });
}
