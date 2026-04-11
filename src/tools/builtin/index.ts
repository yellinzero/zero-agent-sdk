/**
 * Built-in tools index — factory function and convenience exports.
 */

import type { SDKTool } from '../types.js';
import type { AgentToolOptions } from './agent.js';
import { createAgentTool } from './agent.js';
import { createAskUserTool } from './ask-user.js';
import { createBashTool } from './bash.js';
import { createFileEditTool } from './file-edit.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createNotebookEditTool } from './notebook-edit.js';
import { createTaskCreateTool } from './task-create.js';
import { createTaskGetTool } from './task-get.js';
import { createTaskListTool } from './task-list.js';
import { createTaskOutputTool } from './task-output.js';
import { createTaskStopTool } from './task-stop.js';
import { InMemoryTaskStore, type TaskStore } from './task-store.js';
import { createTaskUpdateTool } from './task-update.js';
import { createWebFetchTool, type WebFetchToolOptions } from './web-fetch.js';
import { createWebSearchTool, type WebSearchToolOptions } from './web-search.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BuiltinToolsOptions {
  /** Include Bash command execution tool (default: true) */
  bash?: boolean;
  /** Include file read tool (default: true) */
  fileRead?: boolean;
  /** Include file write tool (default: true) */
  fileWrite?: boolean;
  /** Include file edit tool (default: true) */
  fileEdit?: boolean;
  /** Include glob pattern matching tool (default: true) */
  glob?: boolean;
  /** Include grep/ripgrep content search tool (default: true) */
  grep?: boolean;
  /** Include Jupyter notebook edit tool (default: true) */
  notebookEdit?: boolean;

  /** Include web search tool — requires searchFn. Pass false to disable. */
  webSearch?: WebSearchToolOptions | false;
  /** Include web fetch tool — pass true for defaults, or an options object. */
  webFetch?: WebFetchToolOptions | boolean;
  /** Include ask-user tool (default: false) */
  askUser?: boolean;
  /** Include task management tools — pass true for InMemoryTaskStore, or provide a TaskStore. */
  tasks?: TaskStore | boolean;
  /** Include agent delegation tool — requires createChildAgent. Pass false to disable. */
  agent?: AgentToolOptions | false;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create an array of built-in SDK tools based on the provided options.
 * By default, only the original 7 tools are included (backward-compatible).
 * New tools (webSearch, webFetch, askUser, tasks, agent) are opt-in.
 *
 * @example
 * ```ts
 * // All original tools
 * const tools = builtinTools();
 *
 * // Read-only tools only
 * const readOnly = builtinTools.readOnly();
 *
 * // With task management
 * const withTasks = builtinTools({ tasks: true });
 * ```
 */
export function builtinTools(options?: BuiltinToolsOptions): SDKTool[] {
  const opts = {
    bash: true,
    fileRead: true,
    fileWrite: true,
    fileEdit: true,
    glob: true,
    grep: true,
    notebookEdit: true,
    ...options,
  };

  const tools: SDKTool[] = [];

  // Original 7 tools
  if (opts.bash) tools.push(createBashTool());
  if (opts.fileRead) tools.push(createFileReadTool());
  if (opts.fileWrite) tools.push(createFileWriteTool());
  if (opts.fileEdit) tools.push(createFileEditTool());
  if (opts.glob) tools.push(createGlobTool());
  if (opts.grep) tools.push(createGrepTool());
  if (opts.notebookEdit) tools.push(createNotebookEditTool());

  // New opt-in tools
  if (opts.webSearch) {
    tools.push(createWebSearchTool(opts.webSearch as WebSearchToolOptions));
  }

  if (opts.webFetch) {
    const fetchOpts =
      typeof opts.webFetch === 'object' ? (opts.webFetch as WebFetchToolOptions) : undefined;
    tools.push(createWebFetchTool(fetchOpts));
  }

  if (opts.askUser) {
    tools.push(createAskUserTool());
  }

  if (opts.tasks) {
    const store =
      typeof opts.tasks === 'object' && 'createTask' in opts.tasks
        ? (opts.tasks as TaskStore)
        : new InMemoryTaskStore();
    tools.push(
      createTaskCreateTool(store),
      createTaskUpdateTool(store),
      createTaskListTool(store),
      createTaskGetTool(store),
      createTaskOutputTool(store),
      createTaskStopTool(store)
    );
  }

  if (opts.agent) {
    tools.push(createAgentTool(opts.agent as AgentToolOptions));
  }

  return tools;
}

/**
 * Convenience: all original built-in tools (7).
 */
builtinTools.all = (): SDKTool[] => builtinTools();

/**
 * Convenience: read-only tools only (no write/edit/bash).
 */
builtinTools.readOnly = (): SDKTool[] =>
  builtinTools({
    fileRead: true,
    glob: true,
    grep: true,
    bash: false,
    fileWrite: false,
    fileEdit: false,
    notebookEdit: false,
  });

// ---------------------------------------------------------------------------
// Re-exports for individual tool creation
// ---------------------------------------------------------------------------

export type { AgentToolOptions, ChildAgentResult } from './agent.js';
// New tool exports
export { createAgentTool } from './agent.js';
export { createAskUserTool } from './ask-user.js';
export { createBashTool } from './bash.js';
export { createFileEditTool } from './file-edit.js';
export { createFileReadTool } from './file-read.js';
export { createFileWriteTool } from './file-write.js';
export { createGlobTool } from './glob.js';
export { createGrepTool } from './grep.js';
export { createNotebookEditTool } from './notebook-edit.js';
export { createTaskCreateTool } from './task-create.js';
export { createTaskGetTool } from './task-get.js';
export { createTaskListTool } from './task-list.js';
export { createTaskOutputTool } from './task-output.js';
export { createTaskStopTool } from './task-stop.js';
export type { Task, TaskStore } from './task-store.js';
export { InMemoryTaskStore } from './task-store.js';
export { createTaskUpdateTool } from './task-update.js';
export type { WebFetchToolOptions } from './web-fetch.js';
export { createWebFetchTool } from './web-fetch.js';
export type { WebSearchResult, WebSearchToolOptions } from './web-search.js';
export { createWebSearchTool } from './web-search.js';
