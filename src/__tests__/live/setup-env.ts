/**
 * Vitest setup for live tests — loads provider secrets from an env file
 * pointed to by the LIVE_ENV_FILE environment variable. Existing
 * process.env entries are NOT overwritten so an explicit
 * `KEY=val pnpm test:live` call still wins.
 *
 * Format: standard KEY=VALUE lines, # comments, optional `export ` prefix,
 * optional single/double quotes around the value. No interpolation.
 */

import { readFileSync } from 'node:fs';

const filePath = process.env.LIVE_ENV_FILE;
if (filePath) {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    // Fail loud — silently skipping a missing file would just produce a
    // confusing "all tests skipped" run.
    throw new Error(
      `LIVE_ENV_FILE='${filePath}' is unreadable: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const stripped = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;

    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
