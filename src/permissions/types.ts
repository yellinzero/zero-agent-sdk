/**
 * Permission system types for the SDK.
 * Extracted and simplified from the original CLI permission system.
 */

// ---------------------------------------------------------------------------
// Permission Modes
// ---------------------------------------------------------------------------

export type PermissionMode =
  | 'default' // Ask for permission on dangerous operations
  | 'allowAll' // Allow all operations without asking
  | 'denyAll' // Deny ALL operations including read-only (strict)
  | 'readOnly' // Allow read-only, deny everything else
  | 'custom'; // Use the PermissionHandler

// ---------------------------------------------------------------------------
// Permission Handler (pluggable)
// ---------------------------------------------------------------------------

export interface PermissionHandler {
  /**
   * Called when a tool needs permission to execute.
   * Return 'allow' to proceed, 'deny' to block, or a modified input.
   */
  checkPermission(
    tool: string,
    input: unknown,
    context: PermissionContext
  ): Promise<PermissionDecision>;
}

export interface PermissionContext {
  /** Current working directory */
  cwd: string;

  /** Whether the tool is read-only */
  isReadOnly: boolean;

  /** Whether the tool is destructive */
  isDestructive: boolean;

  /** Tool-specific permission metadata */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Permission Decision
// ---------------------------------------------------------------------------

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message: string }
  | { behavior: 'ask'; message: string };

// ---------------------------------------------------------------------------
// Permission Rule
// ---------------------------------------------------------------------------

export interface PermissionRule {
  toolName: string;
  behavior: 'allow' | 'deny' | 'ask';
  pattern?: string;
}

// ---------------------------------------------------------------------------
// Default Permission Handlers
// ---------------------------------------------------------------------------

/** Allows everything */
export const allowAllHandler: PermissionHandler = {
  async checkPermission() {
    return { behavior: 'allow' };
  },
};

/** Denies ALL operations including read-only — true deny-all */
export const strictDenyAllHandler: PermissionHandler = {
  async checkPermission() {
    return { behavior: 'deny', message: 'All tool execution is denied (denyAll mode)' };
  },
};

/** Denies everything that isn't read-only */
export const readOnlyHandler: PermissionHandler = {
  async checkPermission(_tool, _input, context) {
    if (context.isReadOnly) {
      return { behavior: 'allow' };
    }
    return { behavior: 'deny', message: 'Write operations are not allowed in read-only mode' };
  },
};

/** Allows read-only, asks for destructive and other write operations */
export const defaultHandler: PermissionHandler = {
  async checkPermission(_tool, _input, context) {
    if (context.isReadOnly) {
      return { behavior: 'allow' };
    }
    if (context.isDestructive) {
      return { behavior: 'ask', message: 'Destructive operation — requires explicit approval' };
    }
    return { behavior: 'ask', message: 'This operation requires permission to proceed' };
  },
};

/** Hard-denies destructive operations, allows read-only, asks for others */
export const strictHandler: PermissionHandler = {
  async checkPermission(_tool, _input, context) {
    if (context.isReadOnly) {
      return { behavior: 'allow' };
    }
    if (context.isDestructive) {
      return { behavior: 'deny', message: 'Destructive operations blocked in strict mode' };
    }
    return { behavior: 'ask', message: 'This operation requires permission to proceed' };
  },
};
