/**
 * Tests for the permission system — rules, checker, path validation, and SSRF guard.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkToolPermission, getHandlerForMode } from '../permissions/checker.js';
import { validateFilePath, validateFilePathAsync } from '../permissions/path-validation.js';
import {
  type DenialTrackingState,
  evaluateRules,
  matchRule,
  parseRulePattern,
  recordAllow,
  recordDenial,
} from '../permissions/rules.js';
import type { PermissionContext, PermissionHandler, PermissionRule } from '../permissions/types.js';

// ---------------------------------------------------------------------------
// Mock node:dns/promises for SSRF guard tests
// ---------------------------------------------------------------------------

const mockLookup = vi.fn();

vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    cwd: '/workspace',
    isReadOnly: false,
    isDestructive: false,
    ...overrides,
  };
}

function freshDenialState(): DenialTrackingState {
  return { consecutiveDenials: 0, totalDenials: 0 };
}

// ===========================================================================
// 1. Rule Engine (rules.ts)
// ===========================================================================

describe('Rule Engine', () => {
  // ---- parseRulePattern ---------------------------------------------------

  describe('parseRulePattern', () => {
    it('parses exact match pattern', () => {
      expect(parseRulePattern('git')).toEqual({ type: 'exact', value: 'git' });
    });

    it('parses prefix pattern ending with :*', () => {
      expect(parseRulePattern('npm:*')).toEqual({ type: 'prefix', value: 'npm' });
    });

    it('parses wildcard pattern containing *', () => {
      expect(parseRulePattern('git *')).toEqual({ type: 'wildcard', pattern: 'git *' });
    });

    it('parses complex wildcard pattern', () => {
      expect(parseRulePattern('rm -rf *')).toEqual({ type: 'wildcard', pattern: 'rm -rf *' });
    });
  });

  // ---- matchRule ----------------------------------------------------------

  describe('matchRule', () => {
    it('matches exact command', () => {
      const parsed = parseRulePattern('git');
      expect(matchRule(parsed, 'git')).toBe(true);
    });

    it('matches exact command with args (isCommand=true)', () => {
      const parsed = parseRulePattern('git');
      expect(matchRule(parsed, 'git status', true)).toBe(true);
    });

    it('does not match different command for exact rule', () => {
      const parsed = parseRulePattern('git');
      expect(matchRule(parsed, 'npm install')).toBe(false);
    });

    it('does not match partial prefix for exact rule', () => {
      const parsed = parseRulePattern('git');
      expect(matchRule(parsed, 'gitignore')).toBe(false);
    });

    it('matches prefix rule', () => {
      const parsed = parseRulePattern('npm:*');
      expect(matchRule(parsed, 'npm install')).toBe(true);
      expect(matchRule(parsed, 'npm run build')).toBe(true);
    });

    it('does not match prefix rule for different command', () => {
      const parsed = parseRulePattern('npm:*');
      expect(matchRule(parsed, 'yarn install')).toBe(false);
    });

    it('matches wildcard rule', () => {
      const parsed = parseRulePattern('git *');
      expect(matchRule(parsed, 'git status')).toBe(true);
      expect(matchRule(parsed, 'git commit -m "test"')).toBe(true);
    });

    it('does not match wildcard rule for bare command', () => {
      const parsed = parseRulePattern('git *');
      expect(matchRule(parsed, 'git')).toBe(false);
    });
  });

  // ---- evaluateRules ------------------------------------------------------

  describe('evaluateRules', () => {
    it('returns null when no rules match', () => {
      const rules: PermissionRule[] = [{ toolName: 'Bash', behavior: 'allow', pattern: 'git' }];
      const result = evaluateRules('FileWrite', {}, rules);
      expect(result).toBeNull();
    });

    it('first-match-wins — returns the first matching rule', () => {
      const rules: PermissionRule[] = [
        { toolName: 'Bash', behavior: 'deny', pattern: 'rm:*' },
        { toolName: 'Bash', behavior: 'allow' },
      ];
      const result = evaluateRules('Bash', { command: 'rm -rf /' }, rules);
      expect(result).toEqual({
        behavior: 'deny',
        message: expect.stringContaining('Denied by rule'),
      });
    });

    it('falls through to later rule when first does not match', () => {
      const rules: PermissionRule[] = [
        { toolName: 'Bash', behavior: 'deny', pattern: 'rm:*' },
        { toolName: 'Bash', behavior: 'allow' },
      ];
      const result = evaluateRules('Bash', { command: 'ls -la' }, rules);
      expect(result).toEqual({ behavior: 'allow' });
    });

    it('matches wildcard toolName (*)', () => {
      const rules: PermissionRule[] = [{ toolName: '*', behavior: 'ask' }];
      const result = evaluateRules('AnyTool', {}, rules);
      expect(result).toEqual({
        behavior: 'ask',
        message: expect.stringContaining('Rule requires confirmation'),
      });
    });

    it('filters by tool name', () => {
      const rules: PermissionRule[] = [
        { toolName: 'Bash', behavior: 'deny' },
        { toolName: 'FileRead', behavior: 'allow' },
      ];
      const result = evaluateRules('FileRead', {}, rules);
      expect(result).toEqual({ behavior: 'allow' });
    });

    it('extracts command from input object with cmd key', () => {
      const rules: PermissionRule[] = [{ toolName: 'Bash', behavior: 'deny', pattern: 'rm:*' }];
      const result = evaluateRules('Bash', { cmd: 'rm file.txt' }, rules);
      expect(result).toEqual({
        behavior: 'deny',
        message: expect.stringContaining('Denied by rule'),
      });
    });

    it('skips rule when input has no extractable value and rule has pattern', () => {
      const rules: PermissionRule[] = [{ toolName: 'Bash', behavior: 'deny', pattern: 'rm' }];
      // Input is a raw string (not an object with command/cmd/file_path/url).
      // extractMatchableValue returns null → rule is skipped → returns null.
      // This is the CORRECT behavior: pattern rules should not blindly match
      // when no value can be extracted for comparison.
      const result = evaluateRules('Bash', 'rm file.txt', rules);
      expect(result).toBeNull();
    });

    it('matches rule with file_path pattern for file tools', () => {
      const rules: PermissionRule[] = [{ toolName: 'Write', behavior: 'deny', pattern: '/etc/*' }];
      const result = evaluateRules('Write', { file_path: '/etc/passwd' }, rules);
      expect(result).toEqual({
        behavior: 'deny',
        message: expect.stringContaining('Denied by rule'),
      });
    });

    it('does not match file_path rule for different path', () => {
      const rules: PermissionRule[] = [{ toolName: 'Write', behavior: 'allow', pattern: '/tmp/*' }];
      const result = evaluateRules('Write', { file_path: '/etc/passwd' }, rules);
      expect(result).toBeNull();
    });

    it('deny rules take precedence over allow rules', () => {
      const rules: PermissionRule[] = [
        { toolName: 'Write', behavior: 'allow', pattern: '/tmp/*' },
        { toolName: 'Write', behavior: 'deny', pattern: '/tmp/secret*' },
      ];
      const result = evaluateRules('Write', { file_path: '/tmp/secret.txt' }, rules);
      expect(result).toEqual({
        behavior: 'deny',
        message: expect.stringContaining('Denied by rule'),
      });
    });

    it('returns null when no rules are provided', () => {
      const result = evaluateRules('Bash', {}, []);
      expect(result).toBeNull();
    });
  });

  // ---- Denial Tracking ----------------------------------------------------

  describe('DenialTracking', () => {
    it('recordDenial increments counters', () => {
      const state = freshDenialState();
      recordDenial(state);
      expect(state.consecutiveDenials).toBe(1);
      expect(state.totalDenials).toBe(1);
      recordDenial(state);
      expect(state.consecutiveDenials).toBe(2);
      expect(state.totalDenials).toBe(2);
    });

    it('recordAllow resets consecutive denials but not total', () => {
      const state = freshDenialState();
      recordDenial(state);
      recordDenial(state);
      recordAllow(state);
      expect(state.consecutiveDenials).toBe(0);
      expect(state.totalDenials).toBe(2);
    });

    it('shouldDowngrade triggers when consecutive limit reached (default 3)', () => {
      const state = freshDenialState();
      expect(recordDenial(state).shouldDowngrade).toBe(false);
      expect(recordDenial(state).shouldDowngrade).toBe(false);
      expect(recordDenial(state).shouldDowngrade).toBe(true);
    });

    it('shouldDowngrade triggers with custom consecutive limit', () => {
      const state = freshDenialState();
      expect(recordDenial(state, { maxConsecutive: 2 }).shouldDowngrade).toBe(false);
      expect(recordDenial(state, { maxConsecutive: 2 }).shouldDowngrade).toBe(true);
    });

    it('shouldDowngrade triggers when total limit reached (default 20)', () => {
      const state = freshDenialState();
      for (let i = 0; i < 19; i++) {
        recordDenial(state, { maxConsecutive: 1000 });
        recordAllow(state); // reset consecutive to avoid consecutive trigger
      }
      // totalDenials is 19, consecutiveDenials is 0
      const result = recordDenial(state, { maxConsecutive: 1000 });
      expect(state.totalDenials).toBe(20);
      expect(result.shouldDowngrade).toBe(true);
    });
  });
});

// ===========================================================================
// 2. Permission Checker (checker.ts)
// ===========================================================================

describe('Permission Checker', () => {
  // ---- getHandlerForMode --------------------------------------------------

  describe('getHandlerForMode', () => {
    it('returns allowAllHandler for allowAll mode', async () => {
      const handler = getHandlerForMode('allowAll');
      const decision = await handler.checkPermission('test', {}, makeContext());
      expect(decision.behavior).toBe('allow');
    });

    it('returns strictDenyAllHandler for denyAll mode', async () => {
      const handler = getHandlerForMode('denyAll');

      const readDecision = await handler.checkPermission(
        'test',
        {},
        makeContext({ isReadOnly: true })
      );
      expect(readDecision.behavior).toBe('deny');

      const writeDecision = await handler.checkPermission(
        'test',
        {},
        makeContext({ isReadOnly: false })
      );
      expect(writeDecision.behavior).toBe('deny');
    });

    it('returns readOnlyHandler for readOnly mode', async () => {
      const handler = getHandlerForMode('readOnly');

      const readDecision = await handler.checkPermission(
        'test',
        {},
        makeContext({ isReadOnly: true })
      );
      expect(readDecision.behavior).toBe('allow');

      const writeDecision = await handler.checkPermission(
        'test',
        {},
        makeContext({ isReadOnly: false })
      );
      expect(writeDecision.behavior).toBe('deny');
    });

    it('returns defaultHandler for default mode when no custom handler', async () => {
      const handler = getHandlerForMode('default');

      const readDecision = await handler.checkPermission(
        'test',
        {},
        makeContext({ isReadOnly: true })
      );
      expect(readDecision.behavior).toBe('allow');

      const destructiveDecision = await handler.checkPermission(
        'test',
        {},
        makeContext({ isDestructive: true })
      );
      expect(destructiveDecision.behavior).toBe('ask');

      const otherDecision = await handler.checkPermission('test', {}, makeContext());
      expect(otherDecision.behavior).toBe('ask');
    });

    it('returns custom handler for default mode when provided', async () => {
      const custom: PermissionHandler = {
        async checkPermission() {
          return { behavior: 'allow' };
        },
      };
      const handler = getHandlerForMode('default', custom);
      expect(handler).toBe(custom);
    });

    it('throws for custom mode without handler', () => {
      expect(() => getHandlerForMode('custom')).toThrow(
        'Custom permission mode requires a permissionHandler'
      );
    });

    it('returns custom handler for custom mode', () => {
      const custom: PermissionHandler = {
        async checkPermission() {
          return { behavior: 'allow' };
        },
      };
      const handler = getHandlerForMode('custom', custom);
      expect(handler).toBe(custom);
    });
  });

  // ---- checkToolPermission ------------------------------------------------

  describe('checkToolPermission', () => {
    it('evaluates rules before handler', async () => {
      const rules: PermissionRule[] = [{ toolName: 'Bash', behavior: 'deny' }];
      const decision = await checkToolPermission('Bash', {}, makeContext(), 'allowAll', undefined, {
        rules,
      });
      expect(decision.behavior).toBe('deny');
    });

    it('falls through to handler when no rule matches', async () => {
      const rules: PermissionRule[] = [{ toolName: 'FileWrite', behavior: 'deny' }];
      const decision = await checkToolPermission('Bash', {}, makeContext(), 'allowAll', undefined, {
        rules,
      });
      expect(decision.behavior).toBe('allow');
    });

    it('tracks denials from rules', async () => {
      const state = freshDenialState();
      const rules: PermissionRule[] = [{ toolName: 'Bash', behavior: 'deny' }];
      await checkToolPermission('Bash', {}, makeContext(), 'allowAll', undefined, {
        rules,
        denialTracking: state,
      });
      expect(state.consecutiveDenials).toBe(1);
      expect(state.totalDenials).toBe(1);
    });

    it('tracks allows from rules and resets consecutive', async () => {
      const state: DenialTrackingState = { consecutiveDenials: 2, totalDenials: 5 };
      const rules: PermissionRule[] = [{ toolName: 'Bash', behavior: 'allow' }];
      await checkToolPermission('Bash', {}, makeContext(), 'allowAll', undefined, {
        rules,
        denialTracking: state,
      });
      expect(state.consecutiveDenials).toBe(0);
      expect(state.totalDenials).toBe(5);
    });

    it('auto-downgrades to ask after too many handler denials', async () => {
      const denyHandler: PermissionHandler = {
        async checkPermission() {
          return { behavior: 'deny', message: 'denied' };
        },
      };
      const state = freshDenialState();
      const opts = { denialTracking: state, denialLimits: { maxConsecutive: 2 } };

      // First denial — no downgrade
      const d1 = await checkToolPermission('tool', {}, makeContext(), 'custom', denyHandler, opts);
      expect(d1.behavior).toBe('deny');

      // Second denial — hits maxConsecutive, downgrade to ask
      const d2 = await checkToolPermission('tool', {}, makeContext(), 'custom', denyHandler, opts);
      expect(d2.behavior).toBe('ask');
      expect((d2 as { message: string }).message).toContain('Too many consecutive denials');
    });

    it('handler allow resets consecutive denial tracking', async () => {
      const allowHandler: PermissionHandler = {
        async checkPermission() {
          return { behavior: 'allow' };
        },
      };
      const state: DenialTrackingState = { consecutiveDenials: 2, totalDenials: 5 };
      await checkToolPermission('tool', {}, makeContext(), 'custom', allowHandler, {
        denialTracking: state,
      });
      expect(state.consecutiveDenials).toBe(0);
    });

    it('works without options (no rules, no tracking)', async () => {
      const decision = await checkToolPermission('tool', {}, makeContext(), 'allowAll');
      expect(decision.behavior).toBe('allow');
    });
  });
});

// ===========================================================================
// 3. Path Validation (path-validation.ts)
// ===========================================================================

describe('Path Validation', () => {
  const cwd = '/workspace/project';

  describe('validateFilePath — sensitive paths', () => {
    const sensitivePaths = [
      ['.ssh/id_rsa', 'SSH key'],
      ['/home/user/.ssh/config', 'SSH config'],
      ['.env', 'env file'],
      ['.env.local', 'env local file'],
      ['.env.production', 'env production file'],
      ['.aws/credentials', 'AWS credentials'],
      ['/home/user/.gnupg/secring.gpg', 'GPG key'],
      ['credentials.json', 'credentials file'],
      ['service_account.json', 'service account'],
      ['token.json', 'token file'],
      ['.git-credentials', 'git credentials'],
      ['.npmrc', 'npm config'],
      ['.kube/config', 'kube config'],
      ['.pgpass', 'postgres password'],
      ['.netrc', 'netrc file'],
      ['.docker/config.json', 'docker config'],
      ['server.pem', 'PEM file'],
      ['key_rsa', 'RSA key'],
      ['key_ed25519', 'ED25519 key'],
      ['/etc/shadow', 'shadow file'],
    ];

    for (const [path, label] of sensitivePaths) {
      it(`detects sensitive path: ${label} (${path})`, () => {
        const result = validateFilePath(path, cwd);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeDefined();
        expect(result.requiresExplicitPermission).toBe(true);
      });
    }
  });

  describe('validateFilePath — normal paths', () => {
    const normalPaths = [
      'src/index.ts',
      'package.json',
      'README.md',
      'dist/bundle.js',
      '.gitignore',
      'config/settings.json',
    ];

    for (const path of normalPaths) {
      it(`allows normal path: ${path}`, () => {
        const result = validateFilePath(path, cwd);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
      });
    }
  });

  describe('validateFilePath — workspace boundary', () => {
    it('allows path inside workspace when boundary enforced', () => {
      const result = validateFilePath('src/index.ts', cwd, {
        workspaceRoots: [cwd],
        enforceWorkspaceBoundary: true,
      });
      expect(result.allowed).toBe(true);
    });

    it('denies path outside workspace when boundary enforced', () => {
      const result = validateFilePath('/etc/hosts', cwd, {
        workspaceRoots: [cwd],
        enforceWorkspaceBoundary: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('outside the workspace boundary');
    });

    it('allows path outside workspace when boundary not enforced', () => {
      const result = validateFilePath('/etc/hosts', cwd, {
        workspaceRoots: [cwd],
        enforceWorkspaceBoundary: false,
      });
      expect(result.allowed).toBe(true);
    });

    it('allows path outside workspace when no workspace roots specified', () => {
      const result = validateFilePath('/etc/hosts', cwd, {
        enforceWorkspaceBoundary: true,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateFilePath — extra sensitive patterns', () => {
    it('blocks path matching extra sensitive pattern', () => {
      const result = validateFilePath('secrets.yaml', cwd, {
        extraSensitivePatterns: [/secrets\.yaml$/],
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('validateFilePathAsync — symlink resolution', () => {
    it('allows path when realpath fails (file does not exist)', async () => {
      // validateFilePathAsync catches realpath errors — non-existent files are allowed
      const result = await validateFilePathAsync('nonexistent-file.ts', cwd);
      expect(result.allowed).toBe(true);
    });

    it('allows path when literal and real path are both safe', async () => {
      const result = await validateFilePathAsync('src/index.ts', '/workspace/project');
      expect(result.allowed).toBe(true);
    });

    it('blocks literal sensitive path without needing symlink resolution', async () => {
      const result = await validateFilePathAsync('.ssh/id_rsa', cwd);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('sensitive path pattern');
    });
  });
});

// ===========================================================================
// 4. SSRF Guard (ssrf-guard.ts)
// ===========================================================================

// Import validateUrl lazily so the dns mock is in place
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateUrl } = await import('../permissions/ssrf-guard.js');

describe('SSRF Guard', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    // Default: DNS lookup succeeds with a safe public IP
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
  });

  describe('validateUrl — blocked private IPs via DNS resolution', () => {
    it('blocks 10.x.x.x range', async () => {
      mockLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });

      const result = await validateUrl('http://internal.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IP range');
    });

    it('blocks 172.16-31.x.x range', async () => {
      mockLookup.mockResolvedValue({ address: '172.16.0.1', family: 4 });

      const result = await validateUrl('http://internal.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IP range');
    });

    it('blocks 192.168.x.x range', async () => {
      mockLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 });

      const result = await validateUrl('http://internal.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IP range');
    });

    it('blocks 169.254.x.x link-local range', async () => {
      mockLookup.mockResolvedValue({ address: '169.254.1.1', family: 4 });

      const result = await validateUrl('http://internal.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IP range');
    });

    it('blocks 0.0.0.0/8 range via DNS', async () => {
      mockLookup.mockResolvedValue({ address: '0.0.0.1', family: 4 });

      const result = await validateUrl('http://internal.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IP range');
    });

    it('blocks reserved 240.0.0.0/4 range via DNS', async () => {
      mockLookup.mockResolvedValue({ address: '240.0.0.1', family: 4 });

      const result = await validateUrl('http://internal.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IP range');
    });
  });

  describe('validateUrl — blocked localhost', () => {
    it('blocks 127.0.0.1', async () => {
      const result = await validateUrl('http://127.0.0.1/admin');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('blocks localhost hostname', async () => {
      const result = await validateUrl('http://localhost:8080/api');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('blocks 0.0.0.0', async () => {
      const result = await validateUrl('http://0.0.0.0:3000');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('blocks [::1]', async () => {
      const result = await validateUrl('http://[::1]:3000');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('allows localhost when allowLocalhost is true', async () => {
      // 127.0.0.1 is NOT in isBlockedIPv4 ranges (it checks 0.x, 10.x, etc.)
      mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });

      const result = await validateUrl('http://localhost:3000', { allowLocalhost: true });
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateUrl — metadata endpoints', () => {
    it('blocks AWS metadata endpoint 169.254.169.254', async () => {
      const result = await validateUrl('http://169.254.169.254/latest/meta-data/');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked host');
    });

    it('blocks metadata.google.internal', async () => {
      const result = await validateUrl('http://metadata.google.internal/computeMetadata/v1/');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked host');
    });

    it('blocks kubernetes.default', async () => {
      const result = await validateUrl('http://kubernetes.default/api');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked host');
    });

    it('blocks kubernetes.default.svc', async () => {
      const result = await validateUrl('http://kubernetes.default.svc/api');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked host');
    });

    it('blocks Azure IMDS endpoint 169.254.169.253', async () => {
      const result = await validateUrl('http://169.254.169.253/metadata/instance');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked host');
    });
  });

  describe('validateUrl — non-http schemes', () => {
    it('blocks file:// scheme', async () => {
      const result = await validateUrl('file:///etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked scheme');
    });

    it('blocks ftp:// scheme', async () => {
      const result = await validateUrl('ftp://ftp.example.com/file');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked scheme');
    });

    it('blocks javascript: scheme', async () => {
      const result = await validateUrl('javascript:alert(1)');
      expect(result.allowed).toBe(false);
    });
  });

  describe('validateUrl — invalid URLs', () => {
    it('rejects completely invalid URL', async () => {
      const result = await validateUrl('not a url at all');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Invalid URL');
    });
  });

  describe('validateUrl — valid public URLs', () => {
    it('allows standard HTTPS URL', async () => {
      mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });

      const result = await validateUrl('https://example.com/api/data');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows standard HTTP URL', async () => {
      mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });

      const result = await validateUrl('http://example.com/page');
      expect(result.allowed).toBe(true);
    });

    it('denies URL when DNS resolution fails (conservative default)', async () => {
      mockLookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const result = await validateUrl('https://might-be-valid.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('DNS resolution failed');
    });

    it('allows URL when DNS resolution fails if allowDnsFailure is set', async () => {
      mockLookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const result = await validateUrl('https://might-be-valid.example.com', {
        allowDnsFailure: true,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateUrl — extra blocked hosts', () => {
    it('blocks additional hosts specified in options', async () => {
      const result = await validateUrl('https://evil.internal.corp', {
        extraBlockedHosts: ['evil.internal.corp'],
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked host');
    });
  });

  describe('validateUrl — DNS resolution for IPv6', () => {
    it('blocks IPv6 loopback resolved via DNS', async () => {
      mockLookup.mockResolvedValue({ address: '::1', family: 6 });

      const result = await validateUrl('http://some-host.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IPv6');
    });

    it('blocks IPv6 unique-local (fc00::/7) resolved via DNS', async () => {
      mockLookup.mockResolvedValue({ address: 'fd12:3456::1', family: 6 });

      const result = await validateUrl('http://some-host.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IPv6');
    });

    it('blocks IPv6 link-local (fe80::/10) resolved via DNS', async () => {
      mockLookup.mockResolvedValue({ address: 'fe80::1', family: 6 });

      const result = await validateUrl('http://some-host.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IPv6');
    });

    it('blocks IPv6 unspecified address (::) resolved via DNS', async () => {
      mockLookup.mockResolvedValue({ address: '::', family: 6 });

      const result = await validateUrl('http://some-host.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked IPv6');
    });
  });
});
