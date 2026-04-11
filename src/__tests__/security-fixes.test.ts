/**
 * Tests for all security fixes:
 * - Bash security validation
 * - File tool checkPermissions
 * - Read-before-write completeness
 * - Windows path validation
 * - MCP schema validation
 * - Background task serialization
 */

import { describe, expect, it } from 'vitest';
import { createPassthroughSchema } from '../mcp/schema-utils.js';
import { validateFilePath } from '../permissions/path-validation.js';
import {
  BackgroundTaskManager,
  type SerializableTaskState,
} from '../tools/builtin/background-task.js';
import { isDestructiveCommand, validateBashCommand } from '../tools/builtin/bash-security.js';

// =========================================================================
// Bash Security
// =========================================================================

describe('Bash Security', () => {
  describe('validateBashCommand', () => {
    it('allows simple safe commands', () => {
      expect(validateBashCommand('ls -la').safe).toBe(true);
      expect(validateBashCommand('git status').safe).toBe(true);
      expect(validateBashCommand('echo hello').safe).toBe(true);
      expect(validateBashCommand('npm install').safe).toBe(true);
      expect(validateBashCommand('cat package.json').safe).toBe(true);
    });

    it('flags command substitution $(...)', () => {
      const result = validateBashCommand('echo $(cat /etc/passwd)');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('command substitution');
    });

    it('flags backtick substitution', () => {
      const result = validateBashCommand('echo `whoami`');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('backtick');
    });

    it('flags process substitution', () => {
      expect(validateBashCommand('diff <(ls) /tmp/x').safe).toBe(false);
      expect(validateBashCommand('cat >(tee file)').safe).toBe(false);
    });

    it('flags dangerous pipe targets', () => {
      expect(validateBashCommand('cat file | bash').safe).toBe(false);
      expect(validateBashCommand('curl url | sh').safe).toBe(false);
      expect(validateBashCommand('echo code | python3').safe).toBe(false);
      expect(validateBashCommand('find . | xargs rm').safe).toBe(false);
    });

    it('flags IFS manipulation', () => {
      expect(validateBashCommand('IFS=/ rm -rf /').safe).toBe(false);
    });

    it('flags eval and exec', () => {
      expect(validateBashCommand('eval "rm -rf /"').safe).toBe(false);
      expect(validateBashCommand('exec rm -rf /').safe).toBe(false);
    });

    it('flags source/dot-source', () => {
      expect(validateBashCommand('source /tmp/evil.sh').safe).toBe(false);
    });

    it('flags zsh dangerous commands', () => {
      expect(validateBashCommand('zmodload zsh/system').safe).toBe(false);
      expect(validateBashCommand('emulate -c "evil"').safe).toBe(false);
      expect(validateBashCommand('ztcp 1.2.3.4 80').safe).toBe(false);
    });

    it('flags multi-line commands', () => {
      expect(validateBashCommand('echo hi\nrm -rf /').safe).toBe(false);
    });

    it('allows heredocs', () => {
      expect(validateBashCommand('cat <<EOF\nhello\nEOF').safe).toBe(true);
    });

    it('allows line continuations', () => {
      expect(validateBashCommand('echo \\\nhello').safe).toBe(true);
    });

    it('flags unicode whitespace', () => {
      expect(validateBashCommand('echo\u00A0hello').safe).toBe(false);
      expect(validateBashCommand('echo\u2000hello').safe).toBe(false);
    });

    it('flags carriage return', () => {
      expect(validateBashCommand('echo hi\rsecret').safe).toBe(false);
    });

    it('flags /proc/*/environ access', () => {
      expect(validateBashCommand('cat /proc/self/environ').safe).toBe(false);
    });

    it('flags ANSI-C quoting obfuscation', () => {
      expect(validateBashCommand("echo $'\\x2d'rf /").safe).toBe(false);
    });

    it('flags backslash-escaped operators', () => {
      expect(validateBashCommand('echo hi \\; rm -rf /').safe).toBe(false);
    });

    it('flags dangerous redirect to system paths', () => {
      expect(validateBashCommand('echo x > /etc/passwd').safe).toBe(false);
    });

    it('allows redirect to /dev/null', () => {
      // /dev/null redirects are parsed but not flagged by dangerousRedirects
      expect(validateBashCommand('echo x > /dev/null').safe).toBe(true);
    });

    it('flags control characters', () => {
      expect(validateBashCommand('echo \x01hello').safe).toBe(false);
    });

    it('flags empty commands', () => {
      expect(validateBashCommand('').safe).toBe(false);
      expect(validateBashCommand('   ').safe).toBe(false);
    });

    it('flags suspicious brace expansion', () => {
      expect(validateBashCommand('{rm,-rf,/}').safe).toBe(false);
    });
  });

  describe('isDestructiveCommand', () => {
    it('detects rm -rf', () => {
      expect(isDestructiveCommand('rm -rf /')).toBe(true);
      expect(isDestructiveCommand('rm -r /tmp')).toBe(true);
    });

    it('detects git destructive operations', () => {
      expect(isDestructiveCommand('git reset --hard HEAD~1')).toBe(true);
      expect(isDestructiveCommand('git push origin main --force')).toBe(true);
      expect(isDestructiveCommand('git push -f origin')).toBe(true);
      expect(isDestructiveCommand('git clean -fd')).toBe(true);
      expect(isDestructiveCommand('git branch -D feature')).toBe(true);
    });

    it('detects dd with output', () => {
      expect(isDestructiveCommand('dd if=/dev/zero of=/dev/sda')).toBe(true);
    });

    it('detects mkfs', () => {
      expect(isDestructiveCommand('mkfs.ext4 /dev/sda1')).toBe(true);
    });

    it('does not flag safe commands', () => {
      expect(isDestructiveCommand('ls -la')).toBe(false);
      expect(isDestructiveCommand('git status')).toBe(false);
      expect(isDestructiveCommand('echo hello')).toBe(false);
    });
  });
});

// =========================================================================
// Windows Path Validation
// =========================================================================

describe('Windows Path Validation', () => {
  it('blocks NTFS Alternate Data Streams', () => {
    const result = validateFilePath('file.txt:hidden', '/tmp');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Alternate Data Stream');
  });

  it('blocks 8.3 short filenames', () => {
    const result = validateFilePath('PROGRA~1/test', '/');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('8.3 short filename');
  });

  it('blocks UNC paths', () => {
    const result = validateFilePath('//evil-server/share/file', '/');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('UNC');
  });

  it('blocks DOS device names', () => {
    const result = validateFilePath('CON', '/tmp');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('DOS device name');
  });

  it('blocks triple-dots path components', () => {
    const result = validateFilePath('.../../../etc/passwd', '/tmp');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Ambiguous path component');
  });

  it('blocks shell config files', () => {
    const result = validateFilePath('.bashrc', '/home/user');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sensitive path');
  });

  it('blocks .zshrc', () => {
    const result = validateFilePath('.zshrc', '/home/user');
    expect(result.allowed).toBe(false);
  });

  it('blocks .gitconfig', () => {
    const result = validateFilePath('.gitconfig', '/home/user');
    expect(result.allowed).toBe(false);
  });

  it('allows normal paths', () => {
    const result = validateFilePath('src/index.ts', '/home/user/project');
    expect(result.allowed).toBe(true);
  });
});

// =========================================================================
// MCP Schema Validation
// =========================================================================

describe('MCP Schema Validation', () => {
  it('validates required fields', () => {
    const schema = createPassthroughSchema({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    });

    // Missing required field
    const result1 = schema.safeParse({ age: 25 });
    expect(result1.success).toBe(false);
    expect(result1.error.message).toContain('name');

    // Valid input
    const result2 = schema.safeParse({ name: 'test', age: 25 });
    expect(result2.success).toBe(true);
  });

  it('validates field types', () => {
    const schema = createPassthroughSchema({
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
    });

    const result = schema.safeParse({ count: 'not-a-number' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('count');
  });

  it('accepts valid objects', () => {
    const schema = createPassthroughSchema({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['query'],
    });

    expect(schema.safeParse({ query: 'test', limit: 10 }).success).toBe(true);
    expect(schema.safeParse({ query: 'test' }).success).toBe(true);
  });

  it('rejects non-objects when type is object', () => {
    const schema = createPassthroughSchema({ type: 'object' });
    expect(schema.safeParse('not-an-object').success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse(42).success).toBe(false);
  });

  it('parse throws on invalid input', () => {
    const schema = createPassthroughSchema({
      type: 'object',
      required: ['name'],
    });
    expect(() => schema.parse({})).toThrow('MCP tool input validation failed');
  });
});

// =========================================================================
// Background Task Serialization
// =========================================================================

describe('BackgroundTaskManager serialization', () => {
  it('serializes completed tasks', async () => {
    const mgr = new BackgroundTaskManager();
    mgr.register('task-1', 'test task', async () => 'done');
    // Wait for completion
    await mgr.waitForCompletion('task-1');

    const states = mgr.toSerializable();
    expect(states).toHaveLength(1);
    expect(states[0]!.id).toBe('task-1');
    expect(states[0]!.status).toBe('completed');
    expect(states[0]!.result).toBe('done');
  });

  it('serializes running tasks as stopped', () => {
    const mgr = new BackgroundTaskManager();
    mgr.register('task-2', 'long task', () => new Promise(() => {})); // Never resolves

    const states = mgr.toSerializable();
    expect(states[0]!.status).toBe('stopped');
    expect(states[0]!.error).toContain('interrupted');

    // Clean up
    mgr.stop('task-2');
  });

  it('restores from serializable state', () => {
    const states: SerializableTaskState[] = [
      { id: 'restored-1', description: 'old task', status: 'completed', result: 'hello' },
      { id: 'restored-2', description: 'failed task', status: 'failed', error: 'oops' },
    ];

    const mgr = BackgroundTaskManager.fromSerializable(states);

    const output1 = mgr.getOutput('restored-1');
    expect(output1.status).toBe('completed');
    expect(output1.output).toBe('hello');

    const output2 = mgr.getOutput('restored-2');
    expect(output2.status).toBe('failed');
    expect(output2.output).toBe('oops');
  });

  it('returns not_found for unknown tasks after restore', () => {
    const mgr = BackgroundTaskManager.fromSerializable([]);
    expect(mgr.getOutput('nonexistent').status).toBe('not_found');
  });
});
