/**
 * Bash tool — execute shell commands.
 * Core features: command execution, timeout, stdout/stderr capture, background mode,
 * persistent working directory across invocations.
 */

import { exec as execCb } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildSDKTool, type SDKTool } from '../types.js';
import { getOrCreateBgManager } from './background-task.js';
import { isDestructiveCommand, validateBashCommand } from './bash-security.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execCommand(
  command: string,
  options: {
    cwd: string;
    timeout: number;
    signal?: AbortSignal;
    env?: Record<string, string>;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = execCb(
      command,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: MAX_OUTPUT_SIZE,
        shell: process.env.SHELL || '/bin/bash',
        env: { ...process.env, ...options.env },
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Timeout
          if (error.killed) {
            resolve({
              stdout: stdout?.toString() ?? '',
              stderr: `Command timed out after ${options.timeout}ms\n${stderr?.toString() ?? ''}`,
              exitCode: 124,
            });
            return;
          }
          // Abort
          if (error.message?.includes('abort')) {
            reject(new Error('Command was aborted'));
            return;
          }
          // Command error (non-zero exit)
          resolve({
            stdout: stdout?.toString() ?? '',
            stderr: stderr?.toString() ?? '',
            exitCode: (error as { code?: number }).code ?? 1,
          });
          return;
        }
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          exitCode: 0,
        });
      }
    );

    if (options.signal) {
      options.signal.addEventListener('abort', () => child.kill(), { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Input / Output schemas
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  command: z.string().describe('The command to execute'),
  description: z
    .string()
    .optional()
    .describe('Clear, concise description of what this command does'),
  timeout: z
    .number()
    .optional()
    .describe(`Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS})`),
  run_in_background: z
    .boolean()
    .optional()
    .describe('Set to true to run this command in the background'),
});

type BashInput = z.infer<typeof inputSchema>;

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  interrupted: boolean;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export function createBashTool(): SDKTool<BashInput, BashOutput> {
  return buildSDKTool({
    name: 'Bash',
    aliases: ['BashTool'],
    inputSchema,
    maxResultSizeChars: 30_000,

    async description() {
      return 'Executes a given bash command and returns its output. The working directory persists between commands.';
    },

    async prompt() {
      return [
        'Execute shell commands.',
        `- Commands timeout after ${DEFAULT_TIMEOUT_MS / 1000}s by default (max ${MAX_TIMEOUT_MS / 1000}s).`,
        '- Prefer dedicated tools (Read, Edit, Write, Glob, Grep) over shell equivalents.',
        '- Always quote file paths with spaces.',
        '- Include a description for complex commands.',
      ].join('\n');
    },

    isConcurrencySafe() {
      return false;
    },

    isReadOnly() {
      return false;
    },

    isDestructive(input) {
      return isDestructiveCommand(input.command);
    },

    async checkPermissions(input) {
      // Run comprehensive security validation
      const validation = validateBashCommand(input.command);
      if (!validation.safe) {
        return {
          behavior: 'ask' as const,
          message: `${validation.reason}\nCommand: ${input.command}`,
        };
      }
      // All bash commands require permission by default
      return { behavior: 'ask' as const, message: `Execute command: ${input.command}` };
    },

    async call(input, context) {
      // Use persistent cwd from session state, falling back to context.cwd
      const sessionCwd = (context.getState().bashCwd as string) ?? context.cwd;
      const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

      // Background execution
      if (input.run_in_background) {
        const bgManager = getOrCreateBgManager(context);
        const taskId = randomUUID();
        bgManager.register(taskId, input.description ?? input.command, async (signal) => {
          const result = await execCommand(input.command, {
            cwd: sessionCwd,
            timeout: MAX_TIMEOUT_MS,
            signal,
          });
          return `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`;
        });
        return {
          data: {
            stdout: `Background task started: ${taskId}`,
            stderr: '',
            exitCode: 0,
            interrupted: false,
          },
        };
      }

      // Append pwd to track cwd changes — use UUID marker to prevent collision with command output
      const cwdMarker = `__ZERO_CWD_${randomUUID().replace(/-/g, '')}__`;
      const wrappedCmd = `${input.command}\n__zero_exit=$?\necho "${cwdMarker}$(pwd -P)${cwdMarker}" >&2\nexit $__zero_exit`;

      const result = await execCommand(wrappedCmd, {
        cwd: sessionCwd,
        timeout,
        signal: context.abortSignal,
      });

      // Extract new cwd from stderr
      let newCwd = sessionCwd;
      const cwdRegex = new RegExp(`${cwdMarker}(.+?)${cwdMarker}`);
      const cwdMatch = result.stderr.match(cwdRegex);
      if (cwdMatch?.[1]) {
        newCwd = cwdMatch[1];
        result.stderr = result.stderr.replace(new RegExp(`${cwdMarker}.+?${cwdMarker}\\n?`), '');
      }

      // Update session state if cwd changed
      if (newCwd !== sessionCwd) {
        context.setState((prev) => ({ ...prev, bashCwd: newCwd }));
      }

      return {
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          interrupted: result.exitCode === 124,
        },
        contextModifier: newCwd !== sessionCwd ? (ctx) => ({ ...ctx, cwd: newCwd }) : undefined,
      };
    },

    mapToolResult(output, toolUseId) {
      const parts: string[] = [];

      if (output.stdout) {
        parts.push(output.stdout);
      }

      if (output.stderr) {
        parts.push(output.stderr);
      }

      if (parts.length === 0) {
        if (output.exitCode === 0) {
          parts.push('(No output)');
        } else {
          parts.push(`Command failed with exit code ${output.exitCode}`);
        }
      }

      const content = parts.join('\n');
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        ...(output.exitCode !== 0 && { is_error: true }),
      };
    },
  });
}
