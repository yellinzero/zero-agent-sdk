/**
 * Instruction file & memory loader — reads project instruction files
 * (AGENTS.md, CLAUDE.md, and other compatible files) and memory directory contents.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Default instruction file candidate paths (ordered by priority)
// ---------------------------------------------------------------------------

function defaultInstructionPaths(root: string, home: string): string[] {
  const paths: string[] = [
    // Project-level
    join(root, 'AGENTS.md'),
    join(root, '.zero', 'AGENTS.md'),
    join(root, 'CLAUDE.md'),
    join(root, '.zero', 'CLAUDE.md'),
    join(root, '.claude', 'CLAUDE.md'),
  ];

  if (home) {
    // User-level
    paths.push(
      join(home, '.zero', 'AGENTS.md'),
      join(home, '.zero', 'CLAUDE.md'),
      join(home, '.claude', 'CLAUDE.md')
    );
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Instruction files loader
// ---------------------------------------------------------------------------

export interface InstructionFilesOptions {
  /** Project root directory. Defaults to `process.cwd()`. */
  projectRoot?: string;
  /** User home directory. Defaults to `$HOME` / `$USERPROFILE`. */
  userHome?: string;
  /**
   * Custom list of absolute paths to scan. When provided the default
   * candidate list is replaced entirely.
   */
  instructionFiles?: string[];
}

/**
 * Load and concatenate instruction files from standard locations.
 *
 * Default scan order (project-level, then user-level):
 * 1. `{projectRoot}/AGENTS.md`
 * 2. `{projectRoot}/.zero/AGENTS.md`
 * 3. `{projectRoot}/CLAUDE.md`
 * 4. `{projectRoot}/.zero/CLAUDE.md`
 * 5. `{projectRoot}/.claude/CLAUDE.md`
 * 6. `{userHome}/.zero/AGENTS.md`
 * 7. `{userHome}/.zero/CLAUDE.md`
 * 8. `{userHome}/.claude/CLAUDE.md`
 *
 * Missing files are silently skipped.
 */
export async function loadInstructionFiles(options?: InstructionFilesOptions): Promise<string> {
  const root = options?.projectRoot ?? process.cwd();
  const home = options?.userHome ?? (process.env.HOME || process.env.USERPROFILE || '');

  const paths = options?.instructionFiles ?? defaultInstructionPaths(root, home);

  const contents: string[] = [];

  for (const filePath of paths) {
    try {
      const text = await readFile(filePath, 'utf-8');
      if (text.trim()) {
        contents.push(text.trim());
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  return contents.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Memory files loader
// ---------------------------------------------------------------------------

/**
 * Load all `.md` files from a directory and concatenate their contents.
 * Files are sorted alphabetically for deterministic output.
 */
export async function loadMemoryFiles(dir: string): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return '';
  }

  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();

  const contents: string[] = [];

  for (const file of mdFiles) {
    try {
      const text = await readFile(join(dir, file), 'utf-8');
      if (text.trim()) {
        contents.push(`## ${file}\n\n${text.trim()}`);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return contents.join('\n\n');
}
