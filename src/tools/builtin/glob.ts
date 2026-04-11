/**
 * Glob tool — file pattern matching search.
 * Uses Node.js fs.readdir with recursive option + simple glob matching.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';

// ---------------------------------------------------------------------------
// Simple glob pattern matching (no external dependency)
// ---------------------------------------------------------------------------

function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any path segment
        if (pattern[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        regex += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regex += '[^/]';
      i++;
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end !== -1) {
        const alternatives = pattern.substring(i + 1, end).split(',');
        regex += `(?:${alternatives.map(escapeRegex).join('|')})`;
        i = end + 1;
      } else {
        regex += escapeRegex(c);
        i++;
      }
    } else if (c === '[') {
      const end = pattern.indexOf(']', i);
      if (end !== -1) {
        regex += pattern.substring(i, end + 1);
        i = end + 1;
      } else {
        regex += escapeRegex(c);
        i++;
      }
    } else {
      regex += escapeRegex(c);
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(filePath);
}

// ---------------------------------------------------------------------------
// Input / Output schemas
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files against'),
  path: z
    .string()
    .optional()
    .describe(
      'The directory to search in. If not specified, the current working directory will be used.'
    ),
});

type GlobInput = z.infer<typeof inputSchema>;

interface GlobOutput {
  filenames: string[];
  durationMs: number;
  numFiles: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createGlobTool(): SDKTool<GlobInput, GlobOutput> {
  return buildSDKTool({
    name: 'Glob',
    aliases: ['GlobTool'],
    inputSchema,
    maxResultSizeChars: 100_000,

    async description() {
      return 'Fast file pattern matching tool. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.';
    },

    async prompt() {
      return 'Use Glob to find files by name pattern. Supports ** for recursive matching, * for single-segment wildcards, {a,b} for alternatives.';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    getPath(input) {
      return input.path ? resolve(input.path) : process.cwd();
    },

    async call(input, context) {
      const start = Date.now();
      const searchDir = input.path ? resolve(context.cwd, input.path) : context.cwd;
      const limit = context.globLimits?.maxResults ?? 100;

      let entries: string[];
      try {
        const allEntries = await readdir(searchDir, { recursive: true });
        // Filter by pattern
        entries = allEntries.filter((entry) => matchGlob(entry, input.pattern));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Directory does not exist: ${searchDir}`);
        }
        throw err;
      }

      // Sort by mtime (most recent first)
      const withStats = await Promise.allSettled(
        entries.map(async (entry) => {
          const fullPath = join(searchDir, entry);
          const s = await stat(fullPath);
          return { entry, mtimeMs: s.mtimeMs };
        })
      );

      const sorted = withStats
        .filter(
          (r): r is PromiseFulfilledResult<{ entry: string; mtimeMs: number }> =>
            r.status === 'fulfilled'
        )
        .map((r) => r.value)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      const truncated = sorted.length > limit;
      const limited = sorted.slice(0, limit);
      const filenames = limited.map((item) => {
        const fullPath = join(searchDir, item.entry);
        return relative(context.cwd, fullPath);
      });

      return {
        data: {
          filenames,
          durationMs: Date.now() - start,
          numFiles: filenames.length,
          truncated,
        },
      };
    },

    mapToolResult(output, toolUseId) {
      if (output.filenames.length === 0) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'No files found',
        };
      }
      const lines = [
        ...output.filenames,
        ...(output.truncated
          ? ['(Results are truncated. Consider using a more specific path or pattern.)']
          : []),
      ];
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: lines.join('\n'),
      };
    },
  });
}
