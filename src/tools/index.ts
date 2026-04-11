/**
 * Tools sub-package entry point.
 * Re-exports tool types and built-in tool factories.
 */

export type {
  AgentToolOptions,
  BuiltinToolsOptions,
  ChildAgentResult,
  Task,
  TaskStore,
  WebFetchToolOptions,
  WebSearchResult,
  WebSearchToolOptions,
} from './builtin/index.js';
// Built-in tools
export {
  builtinTools,
  createAgentTool,
  createAskUserTool,
  createBashTool,
  createFileEditTool,
  createFileReadTool,
  createFileWriteTool,
  createGlobTool,
  createGrepTool,
  createNotebookEditTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskOutputTool,
  createTaskStopTool,
  createTaskUpdateTool,
  createWebFetchTool,
  createWebSearchTool,
  InMemoryTaskStore,
} from './builtin/index.js';
export type { ToolBatch, ToolExecutionResult, ToolUseRequest } from './orchestration.js';
export { partitionToolCalls, runTools } from './orchestration.js';
export { ToolRegistry } from './registry.js';
export type {
  PermissionCheckResult,
  SDKTool,
  SDKToolDef,
  SDKToolResult,
  ToolExecutionContext,
  ToolInputJSONSchema,
  ToolProgressEvent,
  ToolProgressFn,
  ValidationResult,
} from './types.js';
export { buildSDKTool, findToolByName, toolMatchesName } from './types.js';
