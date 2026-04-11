/**
 * Bash security validation — detects dangerous command patterns before execution.
 *
 * Production-grade implementation covering the most critical attack vectors:
 *
 * 1. Command substitution ($(), ``, <(), >(), =())
 * 2. Shell operators that chain/pipe commands dangerously
 * 3. IFS manipulation for argument injection
 * 4. Eval-equivalent commands
 * 5. Zsh-specific dangerous builtins
 * 6. Hidden multi-line commands
 * 7. Brace expansion obfuscation
 * 8. Unicode whitespace injection
 * 9. Carriage return injection
 * 10. Proc/environ access
 * 11. Obfuscated flags (ANSI-C quoting, empty quote adjacency)
 * 12. Backslash-escaped operators
 * 13. Destructive command patterns (comprehensive)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BashSecurityResult {
  /** Whether the command appears safe for unattended execution */
  safe: boolean;
  /** Human-readable reason for flagging */
  reason?: string;
  /** Numeric check ID for analytics */
  checkId?: number;
}

// ---------------------------------------------------------------------------
// Check IDs (for analytics/logging)
// ---------------------------------------------------------------------------

const CHECK_IDS = {
  EMPTY_COMMAND: 0,
  COMMAND_SUBSTITUTION: 1,
  DANGEROUS_PIPE_TARGET: 2,
  IFS_MANIPULATION: 3,
  EVAL_EQUIVALENT: 4,
  ZSH_DANGEROUS: 5,
  MULTI_LINE: 6,
  BRACE_EXPANSION: 7,
  UNICODE_WHITESPACE: 8,
  CARRIAGE_RETURN: 9,
  PROC_ENVIRON: 10,
  OBFUSCATED_FLAGS: 11,
  BACKSLASH_OPERATORS: 12,
  DANGEROUS_REDIRECT: 13,
  CONTROL_CHARACTERS: 14,
  MID_WORD_HASH: 15,
} as const;

// ---------------------------------------------------------------------------
// Zsh dangerous commands
// ---------------------------------------------------------------------------

const ZSH_DANGEROUS_COMMANDS = new Set([
  'zmodload',
  'emulate',
  'sysopen',
  'sysread',
  'syswrite',
  'sysseek',
  'zpty',
  'ztcp',
  'zsocket',
  'zf_rm',
  'zf_mv',
  'zf_ln',
  'zf_chmod',
  'zf_chown',
  'zf_mkdir',
  'zf_rmdir',
  'zf_chgrp',
]);

// ---------------------------------------------------------------------------
// Eval-equivalent commands
// ---------------------------------------------------------------------------

const EVAL_COMMANDS = new Set([
  'eval',
  'exec',
  'source',
  'bash',
  'sh',
  'zsh',
  'dash',
  'csh',
  'tcsh',
  'ksh',
]);

// ---------------------------------------------------------------------------
// Command substitution patterns
// ---------------------------------------------------------------------------

const COMMAND_SUBSTITUTION_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\$\(/, message: '$() command substitution' },
  // biome-ignore lint/suspicious/noTemplateCurlyInString: describes shell syntax not template
  { pattern: /\$\{[^}]*[^a-zA-Z0-9_:?+\-=/}]/, message: '${} complex parameter expansion' },
  { pattern: /\$\[/, message: '$[] legacy arithmetic expansion' },
  { pattern: /<\(/, message: 'process substitution <()' },
  { pattern: />\(/, message: 'process substitution >()' },
  { pattern: /=\(/, message: 'Zsh process substitution =()' },
  // Zsh EQUALS expansion: =cmd → $(which cmd)
  { pattern: /(?:^|[\s;&|])=[a-zA-Z_]/, message: 'Zsh equals expansion (=cmd)' },
  // Backticks outside of single quotes
  { pattern: /(?:^|[^\\])`/, message: 'backtick command substitution' },
];

// ---------------------------------------------------------------------------
// Pipe targets that enable shell code execution
// ---------------------------------------------------------------------------

const DANGEROUS_PIPE_TARGETS = new Set([
  'bash',
  'sh',
  'zsh',
  'eval',
  'exec',
  'xargs',
  'python',
  'python3',
  'perl',
  'ruby',
  'node',
  'php',
  'awk',
]);

// ---------------------------------------------------------------------------
// Destructive patterns (comprehensive, checks \b word boundaries)
// ---------------------------------------------------------------------------

const DESTRUCTIVE_COMMAND_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  // rm variants
  { pattern: /\brm\s+-[a-zA-Z]*r/, message: 'recursive rm' },
  { pattern: /\brm\s+--no-preserve-root/, message: 'rm --no-preserve-root' },
  // git destructive
  { pattern: /\bgit\s+reset\s+--hard/, message: 'git reset --hard' },
  { pattern: /\bgit\s+push\s+.*--force/, message: 'git push --force' },
  { pattern: /\bgit\s+push\s+-f\b/, message: 'git push -f' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, message: 'git clean -f' },
  { pattern: /\bgit\s+checkout\s+--\s/, message: 'git checkout -- (discard)' },
  { pattern: /\bgit\s+branch\s+-D\b/, message: 'git branch -D' },
  // Filesystem destructive
  { pattern: /\bdd\s+.*\bof=/, message: 'dd with output file' },
  { pattern: /\bmkfs\b/, message: 'mkfs (format filesystem)' },
  { pattern: /\bchmod\s+-R\s+777\b/, message: 'chmod -R 777' },
  { pattern: /\bchown\s+-R\b/, message: 'recursive chown' },
  // Dangerous redirects (overwrite)
  { pattern: />\s*\/(?!dev\/null\b|tmp\/)/, message: 'redirect overwrite to system path' },
  // Kill/signal
  { pattern: /\bkill\s+-9\b/, message: 'kill -9' },
  { pattern: /\bkillall\b/, message: 'killall' },
  { pattern: /\bpkill\b/, message: 'pkill' },
  // Network exfiltration
  { pattern: /\bcurl\s+.*-[a-zA-Z]*d\b/, message: 'curl with data upload' },
  { pattern: /\bwget\s+.*--post/, message: 'wget with POST' },
];

// ---------------------------------------------------------------------------
// Quote-aware content extraction
// ---------------------------------------------------------------------------

/**
 * Extract content outside of single quotes.
 * Single-quoted content in bash is literal and cannot contain command substitution.
 */
function extractUnquotedContent(command: string): string {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;

    if (escaped) {
      escaped = false;
      if (!inSingleQuote) result += char;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      if (!inSingleQuote) result += char;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote) {
      result += char;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

function validateEmpty(command: string): BashSecurityResult | null {
  if (command.trim().length === 0) {
    return { safe: false, reason: 'Empty command', checkId: CHECK_IDS.EMPTY_COMMAND };
  }
  return null;
}

function validateCommandSubstitution(unquoted: string): BashSecurityResult | null {
  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (pattern.test(unquoted)) {
      return {
        safe: false,
        reason: `Potentially dangerous: ${message}`,
        checkId: CHECK_IDS.COMMAND_SUBSTITUTION,
      };
    }
  }
  return null;
}

function validateDangerousPipeTargets(unquoted: string): BashSecurityResult | null {
  // Match: | <target> or |& <target>
  const pipeMatch = unquoted.match(/\|\s*&?\s*(\w+)/g);
  if (pipeMatch) {
    for (const match of pipeMatch) {
      const target = match.replace(/\|\s*&?\s*/, '').trim();
      if (DANGEROUS_PIPE_TARGETS.has(target)) {
        return {
          safe: false,
          reason: `Potentially dangerous: pipe to ${target}`,
          checkId: CHECK_IDS.DANGEROUS_PIPE_TARGET,
        };
      }
    }
  }
  return null;
}

function validateIFSManipulation(unquoted: string): BashSecurityResult | null {
  if (/\bIFS\s*=/.test(unquoted)) {
    return {
      safe: false,
      reason: 'IFS manipulation detected — can alter argument parsing',
      checkId: CHECK_IDS.IFS_MANIPULATION,
    };
  }
  return null;
}

function validateEvalEquivalents(command: string): BashSecurityResult | null {
  // Extract base command of each segment separated by ;, &&, ||
  const segments = command.split(/\s*(?:;|&&|\|\|)\s*/);
  for (const segment of segments) {
    const baseCmd = segment.trim().split(/\s/)[0]?.replace(/^.*\//, '');
    if (!baseCmd) continue;

    if (EVAL_COMMANDS.has(baseCmd)) {
      return {
        safe: false,
        reason: `Eval-equivalent command: ${baseCmd}`,
        checkId: CHECK_IDS.EVAL_EQUIVALENT,
      };
    }

    // Also check: source/dot-source
    if (baseCmd === '.') {
      const rest = segment.trim().slice(1).trim();
      if (rest.startsWith('/') || rest.startsWith('~') || rest.startsWith('.')) {
        return {
          safe: false,
          reason: 'Dot-source command detected',
          checkId: CHECK_IDS.EVAL_EQUIVALENT,
        };
      }
    }
  }
  return null;
}

function validateZshDangerousCommands(command: string): BashSecurityResult | null {
  const segments = command.split(/\s*(?:;|&&|\|\||\|)\s*/);
  for (const segment of segments) {
    const baseCmd = segment.trim().split(/\s/)[0]?.replace(/^.*\//, '');
    if (baseCmd && ZSH_DANGEROUS_COMMANDS.has(baseCmd)) {
      return {
        safe: false,
        reason: `Blocked zsh command: ${baseCmd}`,
        checkId: CHECK_IDS.ZSH_DANGEROUS,
      };
    }
  }
  return null;
}

function validateMultiLine(command: string): BashSecurityResult | null {
  // Allow line continuations (\ at end of line)
  const withoutContinuations = command.replace(/\\\n/g, '');
  // Allow heredocs (<<EOF ... EOF patterns)
  if (/<<[-~]?\s*['"]?\w+['"]?/.test(command)) return null;

  const lines = withoutContinuations.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 1) {
    return {
      safe: false,
      reason: 'Multi-line command detected — use && or ; to chain commands explicitly',
      checkId: CHECK_IDS.MULTI_LINE,
    };
  }
  return null;
}

function validateBraceExpansion(unquoted: string): BashSecurityResult | null {
  // Detect brace expansion that could obfuscate commands: {rm,-rf,/}
  // Look for patterns like {word,word,...} where words look like command parts
  const bracePattern = /\{[^}]*,[^}]*\}/g;
  const matches = unquoted.match(bracePattern);
  if (matches) {
    for (const match of matches) {
      // Check if any element looks like a command or flag
      const elements = match.slice(1, -1).split(',');
      const hasCommand = elements.some((e) =>
        /^(rm|mv|cp|chmod|chown|dd|mkfs|curl|wget|nc|ncat)$/.test(e.trim())
      );
      const hasFlag = elements.some((e) => /^-[a-zA-Z]/.test(e.trim()));
      if (hasCommand || (hasFlag && elements.length > 2)) {
        return {
          safe: false,
          reason: 'Suspicious brace expansion — may obfuscate command',
          checkId: CHECK_IDS.BRACE_EXPANSION,
        };
      }
    }
  }
  return null;
}

function validateUnicodeWhitespace(command: string): BashSecurityResult | null {
  // Detect non-ASCII whitespace that could confuse parsing
  // Common Unicode whitespace: \u00A0, \u2000-\u200B, \u2028, \u2029, \u202F, \u205F, \u3000, \uFEFF
  if (/[\u00A0\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/.test(command)) {
    return {
      safe: false,
      reason: 'Unicode whitespace detected — may confuse command parsing',
      checkId: CHECK_IDS.UNICODE_WHITESPACE,
    };
  }
  return null;
}

function validateCarriageReturn(command: string): BashSecurityResult | null {
  if (command.includes('\r')) {
    return {
      safe: false,
      reason: 'Carriage return detected — may hide command content',
      checkId: CHECK_IDS.CARRIAGE_RETURN,
    };
  }
  return null;
}

function validateProcEnviron(command: string): BashSecurityResult | null {
  if (/\/proc\/[^/]*\/environ/.test(command)) {
    return {
      safe: false,
      reason: 'Access to /proc/*/environ — may leak secrets',
      checkId: CHECK_IDS.PROC_ENVIRON,
    };
  }
  return null;
}

function validateObfuscatedFlags(unquoted: string): BashSecurityResult | null {
  // ANSI-C quoting: $'\x2d' = '-', $'\055' = '-'
  if (/\$'[^']*\\x2[dD][^']*'/.test(unquoted) || /\$'[^']*\\055[^']*'/.test(unquoted)) {
    return {
      safe: false,
      reason: 'ANSI-C quoted flag obfuscation detected',
      checkId: CHECK_IDS.OBFUSCATED_FLAGS,
    };
  }
  // Empty quote adjacency: ""--force, ''--force
  if (/(?:""|'')--?\w/.test(unquoted)) {
    return {
      safe: false,
      reason: 'Empty quote adjacency — may obfuscate flags',
      checkId: CHECK_IDS.OBFUSCATED_FLAGS,
    };
  }
  return null;
}

function validateBackslashOperators(unquoted: string): BashSecurityResult | null {
  // \; and \| can split commands in some shells
  if (/\\[;|]/.test(unquoted)) {
    return {
      safe: false,
      reason: 'Backslash-escaped shell operators detected',
      checkId: CHECK_IDS.BACKSLASH_OPERATORS,
    };
  }
  return null;
}

function validateDangerousRedirects(unquoted: string): BashSecurityResult | null {
  // Output redirection to sensitive paths
  const redirectPattern = />\s*([^\s&|;]+)/g;
  for (
    let match = redirectPattern.exec(unquoted);
    match !== null;
    match = redirectPattern.exec(unquoted)
  ) {
    const target = match[1]!;
    // Allow /dev/null, /tmp/
    if (target === '/dev/null' || target.startsWith('/tmp/')) continue;
    // Flag redirects to system paths
    if (target.startsWith('/etc/') || target.startsWith('/usr/') || target.startsWith('/bin/')) {
      return {
        safe: false,
        reason: `Output redirect to sensitive path: ${target}`,
        checkId: CHECK_IDS.DANGEROUS_REDIRECT,
      };
    }
  }
  return null;
}

function validateControlCharacters(command: string): BashSecurityResult | null {
  // Control characters (except tab, newline, carriage return which are handled separately)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — detecting control chars is the purpose
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(command)) {
    return {
      safe: false,
      reason: 'Control characters detected in command',
      checkId: CHECK_IDS.CONTROL_CHARACTERS,
    };
  }
  return null;
}

function validateMidWordHash(command: string): BashSecurityResult | null {
  // Mid-word # can desync quote parsing between bash and validators
  // e.g., echo 'x'# comment\nrm -rf /
  if (/\S#/.test(command) && !command.startsWith('#')) {
    // Allow common patterns: shebang, color codes, URLs with fragments
    if (/^#!/.test(command)) return null;
    if (/https?:\/\/[^\s]*#/.test(command)) return null;
    // Check if # appears immediately after a quote close
    if (/['"][^\s]*#/.test(command)) {
      return {
        safe: false,
        reason: 'Quote-adjacent # — may desync comment parsing',
        checkId: CHECK_IDS.MID_WORD_HASH,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validate a bash command for security concerns.
 *
 * Returns `{ safe: true }` if the command appears safe for execution.
 * Returns `{ safe: false, reason, checkId }` if a dangerous pattern is detected.
 *
 * This does NOT mean unsafe commands should be blocked — it means they should
 * require explicit user permission (behavior: 'ask').
 */
export function validateBashCommand(command: string): BashSecurityResult {
  // Run validators in order of severity/likelihood
  const validators = [
    () => validateEmpty(command),
    () => validateControlCharacters(command),
    () => validateCarriageReturn(command),
    () => validateUnicodeWhitespace(command),
    () => validateMultiLine(command),
    () => validateCommandSubstitution(extractUnquotedContent(command)),
    () => validateDangerousPipeTargets(extractUnquotedContent(command)),
    () => validateIFSManipulation(extractUnquotedContent(command)),
    () => validateEvalEquivalents(command),
    () => validateZshDangerousCommands(command),
    () => validateBraceExpansion(extractUnquotedContent(command)),
    () => validateProcEnviron(command),
    () => validateObfuscatedFlags(command),
    () => validateBackslashOperators(extractUnquotedContent(command)),
    () => validateDangerousRedirects(extractUnquotedContent(command)),
    () => validateMidWordHash(command),
  ];

  for (const validator of validators) {
    const result = validator();
    if (result !== null) return result;
  }

  return { safe: true };
}

/**
 * Check if a command is destructive (more comprehensive than basic regex).
 * Used to set isDestructive flag for permission mode decisions.
 */
export function isDestructiveCommand(command: string): boolean {
  const trimmed = command.trim();
  return DESTRUCTIVE_COMMAND_PATTERNS.some(({ pattern }) => pattern.test(trimmed));
}
