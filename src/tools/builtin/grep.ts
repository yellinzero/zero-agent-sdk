/**
 * Grep tool — content search powered by ripgrep.
 * Shells out to `rg` (ripgrep) which must be on PATH.
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { buildSDKTool, type SDKTool, type SDKToolResult } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VCS_DIRS = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'] as const;
const DEFAULT_HEAD_LIMIT = 250;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset: number = 0
): { items: T[]; appliedLimit: number | undefined } {
  if (limit === 0) {
    return { items: items.slice(offset), appliedLimit: undefined };
  }
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT;
  const sliced = items.slice(offset, offset + effectiveLimit);
  const wasTruncated = items.length - offset > effectiveLimit;
  return { items: sliced, appliedLimit: wasTruncated ? effectiveLimit : undefined };
}

function toRelativePath(absPath: string, cwd: string): string {
  const rel = relative(cwd, absPath);
  return rel.startsWith('.') ? rel : rel;
}

function runRipgrep(args: string[], cwd: string, signal?: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'rg',
      args,
      {
        cwd,
        maxBuffer: 50 * 1024 * 1024, // 50MB
        timeout: 30_000,
        signal,
      },
      (error, stdout) => {
        // rg exits with 1 when no matches found — not an error
        if (error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          const exitCode = (error as { code?: number | string }).code;
          if (exitCode === 1 || (typeof exitCode === 'number' && exitCode === 1)) {
            resolve([]);
            return;
          }
          // Check for signal abort
          if (error.killed || error.message?.includes('abort')) {
            reject(new Error('Search was aborted'));
            return;
          }
        }
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              'ripgrep (rg) is not installed or not on PATH. Install it from https://github.com/BurntSushi/ripgrep'
            )
          );
          return;
        }
        const lines = stdout.split('\n').filter(Boolean);
        resolve(lines);
      }
    );

    // Ensure cleanup on abort
    if (signal) {
      signal.addEventListener('abort', () => child.kill(), { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Input / Output schemas
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  pattern: z.string().describe('The regular expression pattern to search for in file contents'),
  path: z.string().optional().describe('File or directory to search in. Defaults to cwd.'),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .optional()
    .describe('Output mode. Defaults to "files_with_matches".'),
  '-B': z.number().optional().describe('Lines before each match (rg -B). Content mode only.'),
  '-A': z.number().optional().describe('Lines after each match (rg -A). Content mode only.'),
  '-C': z.number().optional().describe('Alias for context.'),
  context: z
    .number()
    .optional()
    .describe('Lines before and after each match (rg -C). Content mode only.'),
  '-n': z.boolean().optional().describe('Show line numbers. Content mode only. Defaults to true.'),
  '-i': z.boolean().optional().describe('Case insensitive search.'),
  type: z.string().optional().describe('File type to search (rg --type). E.g. js, py, rust.'),
  head_limit: z
    .number()
    .optional()
    .describe('Limit output to first N entries. Defaults to 250. Pass 0 for unlimited.'),
  offset: z.number().optional().describe('Skip first N entries before applying head_limit.'),
  multiline: z.boolean().optional().describe('Enable multiline mode (rg -U --multiline-dotall).'),
});

type GrepInput = z.infer<typeof inputSchema>;

interface GrepOutput {
  mode: 'content' | 'files_with_matches' | 'count';
  numFiles: number;
  filenames: string[];
  content?: string;
  numLines?: number;
  numMatches?: number;
  appliedLimit?: number;
  appliedOffset?: number;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createGrepTool(): SDKTool<GrepInput, GrepOutput> {
  return buildSDKTool({
    name: 'Grep',
    aliases: ['GrepTool'],
    inputSchema,
    maxResultSizeChars: 20_000,

    async description() {
      return 'A powerful search tool built on ripgrep. Supports regex patterns, file type filtering, context lines, and multiple output modes.';
    },

    async prompt() {
      return 'Use Grep to search file contents with regex patterns. Requires ripgrep (rg) on PATH.';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    getPath(input) {
      return input.path || process.cwd();
    },

    async call(input, context): Promise<SDKToolResult<GrepOutput>> {
      const {
        pattern,
        path: searchPath,
        glob: globFilter,
        type: fileType,
        output_mode = 'files_with_matches',
        '-B': contextBefore,
        '-A': contextAfter,
        '-C': contextC,
        context: contextLines,
        '-n': showLineNumbers = true,
        '-i': caseInsensitive = false,
        head_limit,
        offset = 0,
        multiline = false,
      } = input;

      const absolutePath = searchPath ? resolve(context.cwd, searchPath) : context.cwd;
      const args: string[] = ['--hidden'];

      // Exclude VCS directories
      for (const dir of VCS_DIRS) {
        args.push('--glob', `!${dir}`);
      }

      args.push('--max-columns', '500');

      if (multiline) {
        args.push('-U', '--multiline-dotall');
      }

      if (caseInsensitive) {
        args.push('-i');
      }

      if (output_mode === 'files_with_matches') {
        args.push('-l');
      } else if (output_mode === 'count') {
        args.push('-c');
      }

      if (showLineNumbers && output_mode === 'content') {
        args.push('-n');
      }

      // Context flags
      if (output_mode === 'content') {
        if (contextLines !== undefined) {
          args.push('-C', contextLines.toString());
        } else if (contextC !== undefined) {
          args.push('-C', contextC.toString());
        } else {
          if (contextBefore !== undefined) args.push('-B', contextBefore.toString());
          if (contextAfter !== undefined) args.push('-A', contextAfter.toString());
        }
      }

      // Pattern
      if (pattern.startsWith('-')) {
        args.push('-e', pattern);
      } else {
        args.push(pattern);
      }

      if (fileType) {
        args.push('--type', fileType);
      }

      if (globFilter) {
        const rawPatterns = globFilter.split(/\s+/);
        for (const raw of rawPatterns) {
          if (raw.includes('{') && raw.includes('}')) {
            args.push('--glob', raw);
          } else {
            for (const p of raw.split(',').filter(Boolean)) {
              args.push('--glob', p);
            }
          }
        }
      }

      const results = await runRipgrep(args, absolutePath, context.abortSignal);

      if (output_mode === 'content') {
        const { items: limited, appliedLimit } = applyHeadLimit(results, head_limit, offset);
        const finalLines = limited.map((line) => {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const filePath = line.substring(0, colonIdx);
            const rest = line.substring(colonIdx);
            return toRelativePath(filePath, context.cwd) + rest;
          }
          return line;
        });

        return {
          data: {
            mode: 'content',
            numFiles: 0,
            filenames: [],
            content: finalLines.join('\n'),
            numLines: finalLines.length,
            ...(appliedLimit !== undefined && { appliedLimit }),
            ...(offset > 0 && { appliedOffset: offset }),
          },
        };
      }

      if (output_mode === 'count') {
        const { items: limited, appliedLimit } = applyHeadLimit(results, head_limit, offset);
        const finalLines = limited.map((line) => {
          const colonIdx = line.lastIndexOf(':');
          if (colonIdx > 0) {
            const filePath = line.substring(0, colonIdx);
            const count = line.substring(colonIdx);
            return toRelativePath(filePath, context.cwd) + count;
          }
          return line;
        });

        let totalMatches = 0;
        let fileCount = 0;
        for (const line of finalLines) {
          const colonIdx = line.lastIndexOf(':');
          if (colonIdx > 0) {
            const count = parseInt(line.substring(colonIdx + 1), 10);
            if (!Number.isNaN(count)) {
              totalMatches += count;
              fileCount++;
            }
          }
        }

        return {
          data: {
            mode: 'count',
            numFiles: fileCount,
            filenames: [],
            content: finalLines.join('\n'),
            numMatches: totalMatches,
            ...(appliedLimit !== undefined && { appliedLimit }),
            ...(offset > 0 && { appliedOffset: offset }),
          },
        };
      }

      // files_with_matches mode — sort by mtime
      const withStats = await Promise.allSettled(
        results.map(async (f) => {
          const s = await stat(f);
          return { file: f, mtimeMs: s.mtimeMs };
        })
      );

      const sorted = withStats
        .filter(
          (r): r is PromiseFulfilledResult<{ file: string; mtimeMs: number }> =>
            r.status === 'fulfilled'
        )
        .map((r) => r.value)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map((r) => r.file);

      const { items: finalMatches, appliedLimit } = applyHeadLimit(sorted, head_limit, offset);
      const relativeMatches = finalMatches.map((f) => toRelativePath(f, context.cwd));

      return {
        data: {
          mode: 'files_with_matches',
          filenames: relativeMatches,
          numFiles: relativeMatches.length,
          ...(appliedLimit !== undefined && { appliedLimit }),
          ...(offset > 0 && { appliedOffset: offset }),
        },
      };
    },

    mapToolResult(output, toolUseId) {
      const { mode, numFiles, filenames, content, numMatches, appliedLimit, appliedOffset } =
        output;

      if (mode === 'content') {
        const resultContent = content || 'No matches found';
        const limitParts: string[] = [];
        if (appliedLimit !== undefined) limitParts.push(`limit: ${appliedLimit}`);
        if (appliedOffset) limitParts.push(`offset: ${appliedOffset}`);
        const limitInfo = limitParts.join(', ');
        const finalContent = limitInfo
          ? `${resultContent}\n\n[Showing results with pagination = ${limitInfo}]`
          : resultContent;
        return { type: 'tool_result', tool_use_id: toolUseId, content: finalContent };
      }

      if (mode === 'count') {
        const rawContent = content || 'No matches found';
        const m = numMatches ?? 0;
        const f = numFiles ?? 0;
        const summary = `\n\nFound ${m} total ${m === 1 ? 'occurrence' : 'occurrences'} across ${f} ${f === 1 ? 'file' : 'files'}.`;
        return { type: 'tool_result', tool_use_id: toolUseId, content: rawContent + summary };
      }

      // files_with_matches
      if (numFiles === 0) {
        return { type: 'tool_result', tool_use_id: toolUseId, content: 'No files found' };
      }
      const result = `Found ${numFiles} file${numFiles === 1 ? '' : 's'}\n${filenames.join('\n')}`;
      return { type: 'tool_result', tool_use_id: toolUseId, content: result };
    },
  });
}
