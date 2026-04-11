/**
 * NotebookEdit tool — edit Jupyter notebook (.ipynb) cells.
 * SDK version: simplified from CLI. Core cell replace/insert/delete operations.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { validateFilePathAsync } from '../../permissions/path-validation.js';
import { buildSDKTool, type SDKTool } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotebookCell {
  id?: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[] | string;
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface NotebookContent {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

// ---------------------------------------------------------------------------
// Input / Output schemas
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  notebook_path: z.string().describe('The absolute path to the Jupyter notebook file to edit'),
  cell_id: z
    .string()
    .optional()
    .describe('The ID of the cell to edit. For insert mode, new cell is inserted after this cell.'),
  new_source: z.string().describe('The new source for the cell'),
  cell_type: z
    .enum(['code', 'markdown'])
    .optional()
    .describe('The type of the cell. Required for insert mode.'),
  edit_mode: z
    .enum(['replace', 'insert', 'delete'])
    .optional()
    .describe('The type of edit (replace, insert, delete). Defaults to replace.'),
});

type NotebookEditInput = z.infer<typeof inputSchema>;

interface NotebookEditOutput {
  new_source: string;
  cell_id?: string;
  cell_type: 'code' | 'markdown';
  edit_mode: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceToLines(source: string): string[] {
  const lines = source.split('\n');
  // ipynb format: each line except the last ends with \n
  return lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line));
}

function findCellIndex(cells: NotebookCell[], cellId: string): number {
  // Try by id first
  const byId = cells.findIndex((c) => c.id === cellId);
  if (byId !== -1) return byId;

  // Try numeric index
  const num = parseInt(cellId, 10);
  if (!Number.isNaN(num) && num >= 0 && num < cells.length) return num;

  return -1;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createNotebookEditTool(): SDKTool<NotebookEditInput, NotebookEditOutput> {
  return buildSDKTool({
    name: 'NotebookEdit',
    aliases: ['NotebookEditTool'],
    inputSchema,
    maxResultSizeChars: 100_000,

    async description() {
      return 'Edits Jupyter notebook (.ipynb) cells. Supports replace, insert, and delete operations.';
    },

    async prompt() {
      return [
        'Edit Jupyter notebook cells.',
        '- notebook_path must be an absolute path to a .ipynb file.',
        '- cell_id can be the cell ID string or 0-indexed cell number.',
        '- edit_mode: replace (default), insert (after cell_id), or delete.',
        '- For insert mode, cell_type is required.',
      ].join('\n');
    },

    isConcurrencySafe() {
      return false;
    },

    isReadOnly() {
      return false;
    },

    getPath(input) {
      return input.notebook_path;
    },

    async checkPermissions(input, context) {
      const pathResult = await validateFilePathAsync(input.notebook_path, context.cwd, {
        workspaceRoots: context.workspaceRoots,
        enforceWorkspaceBoundary: context.enforceWorkspaceBoundary,
      });
      if (!pathResult.allowed) {
        return pathResult.requiresExplicitPermission
          ? { behavior: 'ask' as const, message: pathResult.reason! }
          : { behavior: 'deny' as const, message: pathResult.reason! };
      }
      return { behavior: 'ask' as const, message: `Edit notebook: ${input.notebook_path}` };
    },

    async validateInput(input, context) {
      const fullPath = resolve(context.cwd, input.notebook_path);
      if (fullPath.startsWith('\\\\') || fullPath.startsWith('//')) {
        return { result: false, message: 'Network (UNC) paths are not allowed.', errorCode: 10 };
      }
      const pathCheck = await validateFilePathAsync(input.notebook_path, context.cwd, {
        workspaceRoots: context.workspaceRoots,
        enforceWorkspaceBoundary: context.enforceWorkspaceBoundary,
      });
      if (!pathCheck.allowed) {
        return { result: false, message: pathCheck.reason ?? 'Path restricted', errorCode: 11 };
      }
      // read-before-write check (replace/delete modes require prior read)
      if (input.edit_mode !== 'insert') {
        const readState = context.readFileState.get(fullPath);
        if (!readState) {
          return {
            result: false,
            message: 'Notebook has not been read yet. Use the Read tool first.',
            errorCode: 2,
          };
        }
      }
      return { result: true };
    },

    async call(input, context) {
      const { notebook_path, cell_id, new_source, cell_type, edit_mode = 'replace' } = input;
      const fullPath = resolve(context.cwd, notebook_path);

      // Read notebook
      let rawContent: string;
      try {
        rawContent = await readFile(fullPath, 'utf8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Notebook not found: ${notebook_path}`);
        }
        throw err;
      }

      let notebook: NotebookContent;
      try {
        notebook = JSON.parse(rawContent) as NotebookContent;
      } catch {
        throw new Error(`Invalid notebook format: ${notebook_path}`);
      }

      const cells = notebook.cells;
      const sourceLines = sourceToLines(new_source);

      if (edit_mode === 'insert') {
        const newCell: NotebookCell = {
          cell_type: cell_type ?? 'code',
          source: sourceLines,
          metadata: {},
          ...(cell_type !== 'markdown' && { outputs: [], execution_count: null }),
        };

        if (cell_id) {
          const idx = findCellIndex(cells, cell_id);
          if (idx === -1) {
            throw new Error(`Cell not found: ${cell_id}`);
          }
          cells.splice(idx + 1, 0, newCell);
        } else {
          cells.unshift(newCell);
        }

        await writeFile(fullPath, `${JSON.stringify(notebook, null, 1)}\n`, 'utf8');

        return {
          data: {
            new_source,
            cell_id,
            cell_type: cell_type ?? 'code',
            edit_mode: 'insert',
          },
        };
      }

      if (edit_mode === 'delete') {
        if (!cell_id && cell_id !== '0') {
          throw new Error('cell_id is required for delete mode');
        }
        const idx = findCellIndex(cells, cell_id);
        if (idx === -1) {
          throw new Error(`Cell not found: ${cell_id}`);
        }
        const deleted = cells[idx]!;
        cells.splice(idx, 1);

        await writeFile(fullPath, `${JSON.stringify(notebook, null, 1)}\n`, 'utf8');

        return {
          data: {
            new_source,
            cell_id,
            cell_type: deleted.cell_type === 'raw' ? 'code' : deleted.cell_type,
            edit_mode: 'delete',
          },
        };
      }

      // Replace mode
      if (!cell_id && cell_id !== '0') {
        throw new Error('cell_id is required for replace mode');
      }
      const idx = findCellIndex(cells, cell_id);
      if (idx === -1) {
        throw new Error(`Cell not found: ${cell_id}`);
      }

      const cell = cells[idx]!;
      cell.source = sourceLines;
      if (cell_type) {
        cell.cell_type = cell_type;
      }

      await writeFile(fullPath, `${JSON.stringify(notebook, null, 1)}\n`, 'utf8');

      return {
        data: {
          new_source,
          cell_id,
          cell_type: cell.cell_type === 'raw' ? 'code' : cell.cell_type,
          edit_mode: 'replace',
        },
      };
    },

    mapToolResult(output, toolUseId) {
      let msg: string;
      switch (output.edit_mode) {
        case 'replace':
          msg = `Updated cell ${output.cell_id ?? '(unknown)'}`;
          break;
        case 'insert':
          msg = output.cell_id
            ? `Inserted new ${output.cell_type} cell after cell ${output.cell_id}`
            : `Inserted new ${output.cell_type} cell at the beginning`;
          break;
        case 'delete':
          msg = `Deleted cell ${output.cell_id ?? '(unknown)'}`;
          break;
        default:
          msg = 'Notebook edited successfully';
      }

      return { type: 'tool_result', tool_use_id: toolUseId, content: msg };
    },
  });
}
