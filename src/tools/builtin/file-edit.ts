/**
 * FileEdit tool — exact string replacement editing.
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
  file_path: z.string().describe('The absolute path to the file to modify'),
  old_string: z.string().describe('The text to replace'),
  new_string: z
    .string()
    .describe('The text to replace it with (must be different from old_string)'),
  replace_all: z.boolean().optional().describe('Replace all occurrences (default false)'),
});

type FileEditInput = z.infer<typeof inputSchema>;

interface FileEditOutput {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createFileEditTool(): SDKTool<FileEditInput, FileEditOutput> {
  return buildSDKTool({
    name: 'Edit',
    aliases: ['FileEditTool'],
    inputSchema,
    maxResultSizeChars: 100_000,

    async description() {
      return 'Performs exact string replacements in files. The old_string must be unique in the file unless replace_all is true.';
    },

    async prompt() {
      return [
        'Edit files using exact string replacement.',
        '- You must Read the file first before editing.',
        '- old_string must exactly match the file content (including indentation).',
        '- The edit will FAIL if old_string is not unique. Use replace_all or provide more context.',
        '- Use replace_all for renaming variables across the file.',
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
      return { behavior: 'ask' as const, message: `Edit file: ${input.file_path}` };
    },

    async validateInput(input, context) {
      const { file_path, old_string, new_string, replace_all = false } = input;
      const fullPath = resolve(context.cwd, file_path);

      if (old_string === new_string) {
        return {
          result: false,
          message: 'No changes to make: old_string and new_string are exactly the same.',
          errorCode: 1,
        };
      }

      // SECURITY: Block UNC paths (network shares)
      if (fullPath.startsWith('\\\\') || fullPath.startsWith('//')) {
        return {
          result: false,
          message: 'Network (UNC) paths are not allowed for security reasons.',
          errorCode: 10,
        };
      }

      // SECURITY: Check sensitive path patterns
      const pathCheck = await validateFilePathAsync(file_path, context.cwd);
      if (!pathCheck.allowed) {
        return {
          result: false,
          message: pathCheck.reason ?? 'Path is restricted',
          errorCode: 11,
        };
      }

      // Check if file exists
      let fileContent: string | null = null;
      try {
        const buffer = await readFile(fullPath);
        fileContent = buffer.toString('utf8').replaceAll('\r\n', '\n');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // Empty old_string on nonexistent file = new file creation
          if (old_string === '') return { result: true };
          return {
            result: false,
            message: `File does not exist: ${file_path}. Current working directory is ${context.cwd}.`,
            errorCode: 4,
          };
        }
        throw err;
      }

      // Empty old_string but file exists and has content
      if (old_string === '' && fileContent.trim() !== '') {
        return {
          result: false,
          message: 'Cannot create new file - file already exists.',
          errorCode: 3,
        };
      }

      // Check read state
      const readState = context.readFileState.get(fullPath);
      if (!readState && old_string !== '') {
        return {
          result: false,
          message: 'File has not been read yet. Read it first before editing.',
          errorCode: 6,
        };
      }

      // SECURITY: If the file was only partially read, verify the target string
      // is within the portion that was actually read. This prevents the model from
      // editing content it hasn't seen.
      if (readState && readState.fullyRead === false && old_string !== '') {
        if (!readState.content.includes(old_string)) {
          return {
            result: false,
            message:
              'The target string was not in the portion of the file that was read. ' +
              'Read the full file or the relevant section before editing.',
            errorCode: 13,
          };
        }
        // SECURITY: When replace_all is true, check if there are matches in the
        // unread portion — replace_all would blindly affect the entire file.
        if (replace_all && fileContent) {
          const totalMatches = fileContent.split(old_string).length - 1;
          const readMatches = readState.content.split(old_string).length - 1;
          if (totalMatches > readMatches) {
            return {
              result: false,
              message: `replace_all would affect ${totalMatches - readMatches} occurrence(s) in the unread portion of the file. Read the full file first.`,
              errorCode: 14,
            };
          }
        }
      }

      // Check for external modification
      if (readState) {
        try {
          const fileStat = await stat(fullPath);
          const currentMtime = Math.floor(fileStat.mtimeMs);
          if (currentMtime > readState.mtime) {
            return {
              result: false,
              message: 'File has been modified since read. Read it again before editing.',
              errorCode: 7,
            };
          }
        } catch {
          // Non-critical
        }
      }

      // Check old_string exists in file
      if (old_string !== '' && !fileContent.includes(old_string)) {
        return {
          result: false,
          message: `String to replace not found in file.\nString: ${old_string}`,
          errorCode: 8,
        };
      }

      // Check uniqueness
      if (old_string !== '') {
        const matches = fileContent.split(old_string).length - 1;
        if (matches > 1 && !replace_all) {
          return {
            result: false,
            message: `Found ${matches} matches of the string to replace, but replace_all is false. Set replace_all to true or provide more context to uniquely identify the instance.`,
            errorCode: 9,
          };
        }
      }

      return { result: true };
    },

    async call(input, context) {
      const { file_path, old_string, new_string, replace_all = false } = input;
      const fullPath = resolve(context.cwd, file_path);

      // Ensure parent directory exists (for new file creation)
      await mkdir(dirname(fullPath), { recursive: true });

      // Read current content
      let originalContent = '';
      let fileExists = false;
      try {
        const buffer = await readFile(fullPath);
        originalContent = buffer.toString('utf8').replaceAll('\r\n', '\n');
        fileExists = true;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }

      // Perform replacement
      const updatedContent = replace_all
        ? originalContent.replaceAll(old_string, new_string)
        : originalContent.replace(old_string, new_string);

      // Write
      await writeFile(fullPath, updatedContent, 'utf8');

      // Update read state
      try {
        const newStat = await stat(fullPath);
        context.readFileState.set(fullPath, {
          content: updatedContent,
          mtime: Math.floor(newStat.mtimeMs),
        });
      } catch {
        // Non-critical
      }

      return {
        data: {
          filePath: file_path,
          oldString: old_string,
          newString: new_string,
          replaceAll: replace_all,
        },
      };
    },

    mapToolResult(output, toolUseId) {
      const msg = output.replaceAll
        ? `The file ${output.filePath} has been updated. All occurrences were successfully replaced.`
        : `The file ${output.filePath} has been updated successfully.`;
      return { type: 'tool_result', tool_use_id: toolUseId, content: msg };
    },
  });
}
