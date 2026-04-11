/**
 * FileWrite tool — write/create files on the local filesystem.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { validateFilePathAsync } from '../../permissions/path-validation.js';
import { buildSDKTool, type SDKTool } from '../types.js';

// ---------------------------------------------------------------------------
// Input / Output schemas
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  file_path: z
    .string()
    .describe('The absolute path to the file to write (must be absolute, not relative)'),
  content: z.string().describe('The content to write to the file'),
});

type FileWriteInput = z.infer<typeof inputSchema>;

interface FileWriteOutput {
  type: 'create' | 'update';
  filePath: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createFileWriteTool(): SDKTool<FileWriteInput, FileWriteOutput> {
  return buildSDKTool({
    name: 'Write',
    aliases: ['FileWriteTool'],
    inputSchema,
    maxResultSizeChars: 100_000,

    async description() {
      return 'Writes a file to the local filesystem. Creates parent directories as needed. Overwrites existing files.';
    },

    async prompt() {
      return [
        'Write files to the local filesystem.',
        '- This tool will overwrite the existing file if there is one.',
        '- If writing to an existing file, you MUST use the Read tool first.',
        '- Prefer the Edit tool for modifying existing files — it only sends the diff.',
        '- NEVER create documentation files unless explicitly requested.',
      ].join('\n');
    },

    isConcurrencySafe() {
      return false;
    },

    isReadOnly() {
      return false;
    },

    getPath(input) {
      return input.file_path;
    },

    async checkPermissions(input, context) {
      // SECURITY: Check sensitive path patterns + workspace boundary
      const pathResult = await validateFilePathAsync(input.file_path, context.cwd, {
        workspaceRoots: context.workspaceRoots,
        enforceWorkspaceBoundary: context.enforceWorkspaceBoundary,
      });
      if (!pathResult.allowed) {
        return pathResult.requiresExplicitPermission
          ? { behavior: 'ask' as const, message: pathResult.reason! }
          : { behavior: 'deny' as const, message: pathResult.reason! };
      }
      // Non-read-only tool — always require permission in default mode
      return { behavior: 'ask' as const, message: `Write to file: ${input.file_path}` };
    },

    async validateInput(input, context) {
      const fullPath = resolve(context.cwd, input.file_path);

      // SECURITY: Block UNC paths (network shares)
      if (fullPath.startsWith('\\\\') || fullPath.startsWith('//')) {
        return {
          result: false,
          message: 'Network (UNC) paths are not allowed for security reasons.',
          errorCode: 10,
        };
      }

      // SECURITY: Check sensitive path patterns
      const pathCheck = await validateFilePathAsync(input.file_path, context.cwd);
      if (!pathCheck.allowed) {
        return {
          result: false,
          message: pathCheck.reason ?? 'Path is restricted',
          errorCode: 11,
        };
      }

      // Check if file exists — if so, must have been read first
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.isFile()) {
          const readState = context.readFileState.get(fullPath);
          if (!readState) {
            return {
              result: false,
              message: 'File has not been read yet. Read it first before writing to it.',
              errorCode: 2,
            };
          }

          // SECURITY: Require the entire file to have been read before overwriting.
          // Partial reads (e.g. only first line) should not authorize a full overwrite,
          // as the model may not have seen the complete file content.
          if (readState.fullyRead === false) {
            const totalInfo = readState.totalLines
              ? ` (${readState.readLimit ?? '?'} of ${readState.totalLines} lines read)`
              : '';
            return {
              result: false,
              message:
                `File was only partially read${totalInfo}. ` +
                'Read the entire file (without offset/limit) before overwriting, ' +
                'or use the Edit tool for partial modifications.',
              errorCode: 12,
            };
          }

          // Check for external modifications since last read
          const currentMtime = Math.floor(fileStat.mtimeMs);
          if (currentMtime > readState.mtime) {
            return {
              result: false,
              message: 'File has been modified since read. Read it again before writing.',
              errorCode: 3,
            };
          }
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        // File doesn't exist — that's fine for creation
      }

      return { result: true };
    },

    async call(input, context) {
      const fullPath = resolve(context.cwd, input.file_path);
      const dir = dirname(fullPath);

      // Ensure parent directory exists
      await mkdir(dir, { recursive: true });

      // Check if file exists to determine create vs update
      let isUpdate = false;
      try {
        await stat(fullPath);
        isUpdate = true;
      } catch {
        // New file
      }

      // Write the file
      await writeFile(fullPath, input.content, 'utf8');

      // Update read state for staleness tracking
      try {
        const newStat = await stat(fullPath);
        context.readFileState.set(fullPath, {
          content: input.content,
          mtime: Math.floor(newStat.mtimeMs),
        });
      } catch {
        // Non-critical
      }

      return {
        data: {
          type: isUpdate ? ('update' as const) : ('create' as const),
          filePath: input.file_path,
          content: input.content,
        },
      };
    },

    mapToolResult(output, toolUseId) {
      const msg =
        output.type === 'create'
          ? `File created successfully at: ${output.filePath}`
          : `The file ${output.filePath} has been updated successfully.`;
      return { type: 'tool_result', tool_use_id: toolUseId, content: msg };
    },
  });
}
