/**
 * FileRead tool — read files from the local filesystem.
 * Supports text files, images (base64), and basic PDF/notebook detection.
 */

import { createReadStream, promises as fsp } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { validateFilePathAsync } from '../../permissions/path-validation.js';
import { buildSDKTool, type SDKTool, type SDKToolResult } from '../types.js';

const { readFile, stat } = fsp;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const BINARY_EXTENSIONS = new Set([
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'o',
  'a',
  'lib',
  'zip',
  'tar',
  'gz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'class',
  'pyc',
  'wasm',
  'db',
  'sqlite',
  'sqlite3',
]);
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
]);

const DEFAULT_LINE_LIMIT = 2000;
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const totalWidth = String(startLine + lines.length).length;
  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(totalWidth, ' ');
      return `${lineNum}\t${line}`;
    })
    .join('\n');
}

/**
 * Read specific lines from a file using streaming to avoid loading the entire file into memory.
 */
async function readLinesStreaming(
  filePath: string,
  startLine: number, // 0-indexed
  maxLines: number
): Promise<{ lines: string[]; totalLines: number }> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  let lineNum = 0;
  const endLine = startLine + maxLines;

  for await (const line of rl) {
    if (lineNum >= startLine && lineNum < endLine) {
      lines.push(line);
    }
    lineNum++;
  }

  return { lines, totalLines: lineNum };
}

// ---------------------------------------------------------------------------
// Input / Output schemas
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to read'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('The line number to start reading from (1-indexed)'),
  limit: z.number().int().positive().optional().describe('The number of lines to read'),
  pages: z
    .string()
    .optional()
    .describe(
      'Page range for PDF files (e.g., "1-5"). Currently ignored — PDF files are read as raw text.'
    ),
});

type FileReadInput = z.infer<typeof inputSchema>;

type FileReadOutput = {
  type: 'text' | 'image';
  file: {
    filePath?: string;
    content?: string;
    numLines?: number;
    startLine?: number;
    totalLines?: number;
    base64?: string;
    mediaType?: string;
    originalSize?: number;
  };
};

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createFileReadTool(): SDKTool<FileReadInput, FileReadOutput> {
  return buildSDKTool({
    name: 'Read',
    aliases: ['FileReadTool'],
    inputSchema,
    maxResultSizeChars: Infinity,

    async description() {
      return 'Reads a file from the local filesystem. Supports text files and images. For text files, returns content with line numbers. For images, returns base64-encoded data.';
    },

    async prompt() {
      return [
        'Read files from the local filesystem.',
        '- The file_path parameter must be an absolute path',
        `- By default, reads up to ${DEFAULT_LINE_LIMIT} lines from the beginning`,
        '- You can specify offset and limit for large files',
        '- Can read images (PNG, JPG, etc.) as base64',
        '- Lines are returned with line numbers in "cat -n" format',
      ].join('\n');
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    getPath(input) {
      return input.file_path;
    },

    async checkPermissions(input, context) {
      const result = await validateFilePathAsync(input.file_path, context.cwd, {
        workspaceRoots: context.workspaceRoots,
        enforceWorkspaceBoundary: context.enforceWorkspaceBoundary,
      });
      if (!result.allowed) {
        return result.requiresExplicitPermission
          ? { behavior: 'ask' as const, message: result.reason! }
          : { behavior: 'deny' as const, message: result.reason! };
      }
      return { behavior: 'allow' as const };
    },

    async validateInput(input) {
      const fullPath = resolve(input.file_path);

      if (BLOCKED_DEVICE_PATHS.has(fullPath)) {
        return {
          result: false,
          message: `Cannot read '${input.file_path}': this device file would block or produce infinite output.`,
          errorCode: 9,
        };
      }

      const ext = extname(fullPath).toLowerCase().slice(1);
      if (BINARY_EXTENSIONS.has(ext)) {
        return {
          result: false,
          message: `Cannot read binary .${ext} files. Use appropriate tools for binary file analysis.`,
          errorCode: 4,
        };
      }

      return { result: true };
    },

    async call(input, context): Promise<SDKToolResult<FileReadOutput>> {
      const { file_path, offset = 1, limit } = input;
      const fullPath = resolve(context.cwd, file_path);
      const ext = extname(fullPath).toLowerCase().slice(1);

      // Image handling
      if (IMAGE_EXTENSIONS.has(ext)) {
        const buffer = await readFile(fullPath);
        if (buffer.length === 0) {
          throw new Error(`Image file is empty: ${file_path}`);
        }
        const mediaType = ext === 'jpg' ? 'jpeg' : ext;
        return {
          data: {
            type: 'image' as const,
            file: {
              base64: buffer.toString('base64'),
              mediaType: `image/${mediaType}`,
              originalSize: buffer.length,
            },
          },
        };
      }

      // Text file handling
      const maxSize = context.fileReadingLimits?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
      const lineOffset = offset === 0 ? 0 : offset - 1;
      const effectiveLimit = limit ?? DEFAULT_LINE_LIMIT;

      // Use streaming when offset/limit is specified to avoid loading entire file
      if (input.offset || input.limit) {
        let totalLines: number;
        let selectedLines: string[];
        try {
          const result = await readLinesStreaming(fullPath, lineOffset, effectiveLimit);
          totalLines = result.totalLines;
          selectedLines = result.lines;
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
              `File does not exist: ${file_path}. Current working directory is ${context.cwd}.`
            );
          }
          throw err;
        }

        const selectedContent = selectedLines.join('\n');

        // Update read state for staleness tracking
        try {
          const fileStat = await stat(fullPath);
          context.readFileState.set(fullPath, {
            content: selectedContent,
            mtime: Math.floor(fileStat.mtimeMs),
            totalLines,
            readOffset: lineOffset,
            readLimit: effectiveLimit,
            fullyRead: lineOffset === 0 && selectedLines.length >= totalLines,
          });
        } catch {
          // stat failed — non-critical
        }

        return {
          data: {
            type: 'text' as const,
            file: {
              filePath: file_path,
              content: selectedContent,
              numLines: selectedLines.length,
              startLine: offset,
              totalLines,
            },
          },
        };
      }

      // Full file read (no offset/limit specified)
      let fileBuffer: Buffer;
      try {
        fileBuffer = await readFile(fullPath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            `File does not exist: ${file_path}. Current working directory is ${context.cwd}.`
          );
        }
        throw err;
      }

      if (fileBuffer.length > maxSize) {
        throw new Error(
          `File is too large (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB). ` +
            `Use offset and limit parameters to read specific portions.`
        );
      }

      const content = fileBuffer.toString('utf8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;

      const selectedLines = allLines.slice(lineOffset, lineOffset + effectiveLimit);
      const selectedContent = selectedLines.join('\n');

      // Update read state for staleness tracking
      try {
        const fileStat = await stat(fullPath);
        context.readFileState.set(fullPath, {
          content: selectedContent,
          mtime: Math.floor(fileStat.mtimeMs),
          totalLines,
          readOffset: lineOffset,
          readLimit: effectiveLimit,
          fullyRead: lineOffset === 0 && selectedLines.length >= totalLines,
        });
      } catch {
        // stat failed — non-critical
      }

      return {
        data: {
          type: 'text' as const,
          file: {
            filePath: file_path,
            content: selectedContent,
            numLines: selectedLines.length,
            startLine: offset,
            totalLines,
          },
        },
      };
    },

    mapToolResult(output, toolUseId) {
      if (output.type === 'image' && output.file.base64) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: [
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                data: output.file.base64,
                media_type: output.file.mediaType ?? 'image/png',
              },
            },
          ],
        };
      }

      const { file } = output;
      if (!file.content) {
        const msg =
          (file.totalLines ?? 0) === 0
            ? 'Warning: the file exists but the contents are empty.'
            : `Warning: the file is shorter than the provided offset (${file.startLine}). The file has ${file.totalLines} lines.`;
        return { type: 'tool_result', tool_use_id: toolUseId, content: msg };
      }

      let content = addLineNumbers(file.content, file.startLine || 1);

      // Expose file size and read range so the model knows about partial reads
      // and can make informed decisions about subsequent reads/writes
      if (file.totalLines && file.numLines && file.numLines < file.totalLines) {
        const startLine = file.startLine || 1;
        const endLine = startLine + file.numLines - 1;
        content += `\n\n[Showing lines ${startLine}-${endLine} of ${file.totalLines} total lines. Use offset and limit to read other sections.]`;
      }

      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
      };
    },
  });
}
