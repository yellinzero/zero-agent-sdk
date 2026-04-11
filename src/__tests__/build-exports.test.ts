/**
 * Build exports test — verifies that all package.json export paths
 * point to files that actually exist in the dist directory.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../');

describe('Build exports', () => {
  it('all package.json export paths exist in dist', async () => {
    const pkgJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));
    const exports = pkgJson.exports as Record<string, any>;

    const missing: string[] = [];

    for (const [entrypoint, conditions] of Object.entries(exports)) {
      for (const conditionKey of ['import', 'require'] as const) {
        const condition = conditions[conditionKey];
        if (!condition) continue;

        for (const [field, relativePath] of Object.entries(condition)) {
          if (typeof relativePath !== 'string') continue;
          const fullPath = resolve(ROOT, relativePath);
          if (!existsSync(fullPath)) {
            missing.push(`${entrypoint} → ${conditionKey}.${field}: ${relativePath}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('main and module fields point to existing files', async () => {
    const pkgJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'));

    if (pkgJson.main) {
      expect(existsSync(resolve(ROOT, pkgJson.main))).toBe(true);
    }
    if (pkgJson.module) {
      expect(existsSync(resolve(ROOT, pkgJson.module))).toBe(true);
    }
    if (pkgJson.types) {
      expect(existsSync(resolve(ROOT, pkgJson.types))).toBe(true);
    }
  });
});
