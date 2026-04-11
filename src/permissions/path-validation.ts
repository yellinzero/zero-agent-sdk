/**
 * Path validation — checks file paths against sensitive patterns and workspace boundaries.
 * Prevents agents from accessing credentials, SSH keys, and other sensitive files
 * without explicit permission.
 */

import { normalize, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Sensitive path patterns
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: RegExp[] = [
  // System credentials
  /^\/etc\/shadow$/,
  /^\/etc\/gshadow$/,
  // SSH keys and config
  /[/\\]\.ssh[/\\]/,
  // Cloud credentials
  /[/\\]\.aws[/\\]/,
  /[/\\]\.azure[/\\]/,
  /[/\\]\.gcloud[/\\]/,
  /[/\\]\.config[/\\]gcloud[/\\]/,
  // GPG keys
  /[/\\]\.gnupg[/\\]/,
  // Environment files
  /[/\\]\.env(\.[a-zA-Z]+)?$/,
  /[/\\]\.env\.local$/,
  // Token and credential files
  /[/\\]credentials\.json$/,
  /[/\\]service[_-]?account\.json$/,
  /[/\\]tokens?\.json$/,
  // Git credentials
  /[/\\]\.git-credentials$/,
  /[/\\]\.git[/\\]config$/,
  // Package registry tokens
  /[/\\]\.npmrc$/,
  /[/\\]\.pypirc$/,
  /[/\\]\.gem[/\\]credentials$/,
  /[/\\]\.docker[/\\]config\.json$/,
  // Kubernetes
  /[/\\]\.kube[/\\]config$/,
  // Database files with possible credentials
  /[/\\]\.pgpass$/,
  /[/\\]\.my\.cnf$/,
  /[/\\]\.netrc$/,
  // macOS keychain
  /[/\\]Keychains[/\\]/,
  // Private keys
  /[/\\].*\.pem$/,
  /[/\\].*_rsa$/,
  /[/\\].*_ecdsa$/,
  /[/\\].*_ed25519$/,
  // Shell config files (can execute arbitrary code on shell startup)
  /[/\\]\.bashrc$/,
  /[/\\]\.bash_profile$/,
  /[/\\]\.zshrc$/,
  /[/\\]\.zprofile$/,
  /[/\\]\.profile$/,
  /[/\\]\.zshenv$/,
  // IDE/tool config (can auto-execute code)
  /[/\\]\.vscode[/\\]settings\.json$/,
  /[/\\]\.idea[/\\]/,
  // Git config (can execute hooks)
  /[/\\]\.gitconfig$/,
  // Compatible agent / MCP config
  /[/\\]\.mcp\.json$/,
  /[/\\]\.claude\.json$/,
  /[/\\]\.claude[/\\]settings/,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PathValidationResult {
  /** Whether the path is allowed without extra permission */
  allowed: boolean;
  /** Human-readable reason for denial */
  reason?: string;
  /** When true, the tool should return 'ask' instead of 'deny' */
  requiresExplicitPermission?: boolean;
}

export interface PathValidationOptions {
  /** Workspace root directories. Paths outside these require permission. */
  workspaceRoots?: string[];
  /** Whether to enforce workspace boundary (default: false — advisory only) */
  enforceWorkspaceBoundary?: boolean;
  /** Additional sensitive patterns to check */
  extraSensitivePatterns?: RegExp[];
}

// ---------------------------------------------------------------------------
// Windows-specific path security
// ---------------------------------------------------------------------------

/** DOS reserved device names that can cause hangs or data loss */
const DOS_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Validate Windows-specific path bypass vectors.
 * Returns a denial result if a dangerous pattern is found, null otherwise.
 *
 * Checks:
 * 1. NTFS Alternate Data Streams (file.txt:hidden_stream)
 * 2. 8.3 short filename patterns (PROGRA~1)
 * 3. Long path prefixes (\\?\, \\.\) that bypass length/char limits
 * 4. Trailing dots and spaces (silently stripped by Windows)
 * 5. DOS device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 * 6. Triple-dots path components
 */
function validateWindowsPath(rawPath: string, normalizedPath: string): PathValidationResult | null {
  // NTFS Alternate Data Streams — colon after drive letter position
  // Valid: C:\path (drive letter), Invalid: C:\path\file.txt:stream
  const withoutDrive = normalizedPath.replace(/^[a-zA-Z]:/, '');
  if (withoutDrive.includes(':')) {
    return {
      allowed: false,
      reason: `NTFS Alternate Data Stream detected in path '${rawPath}'`,
      requiresExplicitPermission: true,
    };
  }

  // 8.3 short filename pattern: ~\d in a path segment
  const segments = normalizedPath.split(/[/\\]/);
  for (const segment of segments) {
    if (/~\d/.test(segment) && segment.length <= 12) {
      return {
        allowed: false,
        reason: `Possible 8.3 short filename in path '${rawPath}' — may bypass name checks`,
        requiresExplicitPermission: true,
      };
    }
  }

  // Windows long path prefixes
  if (/^(\\\\[?.]\\|\/\/[?.]\/)/.test(rawPath)) {
    return {
      allowed: false,
      reason: `Windows long path prefix detected in '${rawPath}'`,
      requiresExplicitPermission: true,
    };
  }

  // UNC paths (network shares — potential credential leakage via NTLM)
  if (rawPath.startsWith('\\\\') || rawPath.startsWith('//')) {
    return {
      allowed: false,
      reason: `Network (UNC) path detected in '${rawPath}' — potential credential leakage`,
      requiresExplicitPermission: true,
    };
  }

  // Trailing dots and spaces — Windows silently strips these
  for (const segment of segments) {
    if (segment.length > 0 && (segment.endsWith('.') || segment.endsWith(' '))) {
      return {
        allowed: false,
        reason: `Trailing dots/spaces in path segment '${segment}' — may bypass validation on Windows`,
        requiresExplicitPermission: true,
      };
    }
  }

  // DOS device names
  for (const segment of segments) {
    const baseName = segment.split('.')[0]?.toLowerCase();
    if (baseName && DOS_DEVICE_NAMES.has(baseName)) {
      return {
        allowed: false,
        reason: `DOS device name '${segment}' in path — may cause hangs or data loss`,
        requiresExplicitPermission: true,
      };
    }
  }

  // Triple-dots (or more) as path component — ambiguous traversal
  // Check raw path since resolve() treats '...' as a regular directory name
  const rawSegments = rawPath.split(/[/\\]/);
  for (const segment of rawSegments) {
    if (/^\.{3,}$/.test(segment)) {
      return {
        allowed: false,
        reason: `Ambiguous path component '${segment}' — potential path traversal`,
        requiresExplicitPermission: true,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a file path for security concerns.
 *
 * 1. Resolve to absolute path and normalize
 * 2. Check against sensitive path patterns (SSH keys, credentials, etc.)
 * 3. Optionally check workspace boundary
 *
 * Note: This performs synchronous path analysis. For symlink resolution,
 * use `validateFilePathAsync` which calls `fs.realpath`.
 */
export function validateFilePath(
  filePath: string,
  cwd: string,
  options: PathValidationOptions = {}
): PathValidationResult {
  const absPath = resolve(cwd, filePath);
  const normalizedPath = normalize(absPath);

  // SECURITY: Windows-specific path bypass prevention
  const windowsResult = validateWindowsPath(filePath, normalizedPath);
  if (windowsResult) return windowsResult;

  // Check sensitive patterns
  const allPatterns = options.extraSensitivePatterns
    ? [...SENSITIVE_PATTERNS, ...options.extraSensitivePatterns]
    : SENSITIVE_PATTERNS;

  // Check both original and lowercased path (case-insensitive for cross-platform safety)
  const pathsToCheck = [normalizedPath, normalizedPath.toLowerCase()];
  for (const pathToCheck of pathsToCheck) {
    for (const pattern of allPatterns) {
      if (pattern.test(pathToCheck)) {
        return {
          allowed: false,
          reason: `Access to '${filePath}' is restricted — matches a sensitive path pattern`,
          requiresExplicitPermission: true,
        };
      }
    }
  }

  // Workspace boundary check
  if (options.enforceWorkspaceBoundary && options.workspaceRoots?.length) {
    const inWorkspace = options.workspaceRoots.some((root) =>
      normalizedPath.startsWith(`${resolve(root)}/`)
    );
    if (!inWorkspace) {
      return {
        allowed: false,
        reason: `Path '${filePath}' is outside the workspace boundary`,
        requiresExplicitPermission: true,
      };
    }
  }

  return { allowed: true };
}

/**
 * Async version that also resolves symlinks to prevent symlink-based bypass.
 */
export async function validateFilePathAsync(
  filePath: string,
  cwd: string,
  options: PathValidationOptions = {}
): Promise<PathValidationResult> {
  // First check the literal path
  const literalResult = validateFilePath(filePath, cwd, options);
  if (!literalResult.allowed) return literalResult;

  // Then resolve symlinks and re-check
  const absPath = resolve(cwd, filePath);
  try {
    const { realpath } = await import('node:fs/promises');
    const realPath = await realpath(absPath);

    if (realPath !== absPath) {
      // Path was a symlink — re-validate the real path
      const realResult = validateFilePath(realPath, '/', options);
      if (!realResult.allowed) {
        return {
          allowed: false,
          reason: `Symlink '${filePath}' resolves to restricted path: ${realResult.reason}`,
          requiresExplicitPermission: true,
        };
      }
    }
  } catch {
    // File doesn't exist yet (write case) or realpath failed — that's fine
  }

  return { allowed: true };
}
