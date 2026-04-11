import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadInstructionFiles, loadMemoryFiles } from '../context/memory.js';
import { buildSystemPrompt } from '../context/system-prompt.js';

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('should return empty string for empty config', async () => {
    const result = await buildSystemPrompt({});
    expect(result).toBe('');
  });

  it('should include basePrompt', async () => {
    const result = await buildSystemPrompt({ basePrompt: 'You are a helpful assistant.' });
    expect(result).toContain('You are a helpful assistant.');
  });

  it('should include instruction content', async () => {
    const result = await buildSystemPrompt({
      basePrompt: 'Base',
      instructionContent: 'Project rules here.',
    });
    expect(result).toContain('Base');
    expect(result).toContain('Project rules here.');
    expect(result).toContain('Project Instructions');
  });

  it('should include memory content', async () => {
    const result = await buildSystemPrompt({
      memoryContent: 'Remember this fact.',
    });
    expect(result).toContain('Remember this fact.');
    expect(result).toContain('Memory');
  });

  it('should include custom sections', async () => {
    const result = await buildSystemPrompt({
      customSections: [
        { title: 'Guidelines', content: 'Be concise.' },
        { title: 'Style', content: 'Use TypeScript.' },
      ],
    });
    expect(result).toContain('# Guidelines');
    expect(result).toContain('Be concise.');
    expect(result).toContain('# Style');
    expect(result).toContain('Use TypeScript.');
  });

  it('should assemble sections in correct order', async () => {
    const result = await buildSystemPrompt({
      basePrompt: 'AAA',
      instructionContent: 'BBB',
      memoryContent: 'CCC',
      customSections: [{ title: 'DDD', content: 'EEE' }],
    });
    const aIdx = result.indexOf('AAA');
    const bIdx = result.indexOf('BBB');
    const cIdx = result.indexOf('CCC');
    const eIdx = result.indexOf('EEE');
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(eIdx);
  });
});

// ---------------------------------------------------------------------------
// loadInstructionFiles
// ---------------------------------------------------------------------------

describe('loadInstructionFiles', () => {
  let tempDir: string;

  it('should return empty string when no files exist', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: tempDir });
    expect(result).toBe('');
    await rm(tempDir, { recursive: true });
  });

  it('should read AGENTS.md from project root', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    await writeFile(join(tempDir, 'AGENTS.md'), 'Agent instructions');
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: '/nonexistent' });
    expect(result).toContain('Agent instructions');
    await rm(tempDir, { recursive: true });
  });

  it('should read compatible CLAUDE.md from project root', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    await writeFile(join(tempDir, 'CLAUDE.md'), 'Project instructions');
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: '/nonexistent' });
    expect(result).toContain('Project instructions');
    await rm(tempDir, { recursive: true });
  });

  it('should read compatible instruction files from .zero directory', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    await mkdir(join(tempDir, '.zero'), { recursive: true });
    await writeFile(join(tempDir, '.zero', 'CLAUDE.md'), 'Zero-claude instructions');
    await writeFile(join(tempDir, '.zero', 'AGENTS.md'), 'Zero-agents instructions');
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: '/nonexistent' });
    expect(result).toContain('Zero-claude instructions');
    expect(result).toContain('Zero-agents instructions');
    await rm(tempDir, { recursive: true });
  });

  it('should concatenate neutral and compatible instruction files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    await writeFile(join(tempDir, 'AGENTS.md'), 'Root agents');
    await writeFile(join(tempDir, 'CLAUDE.md'), 'Root claude');
    await mkdir(join(tempDir, '.claude'), { recursive: true });
    await writeFile(join(tempDir, '.claude', 'CLAUDE.md'), 'Dot-claude instructions');
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: '/nonexistent' });
    expect(result).toContain('Root agents');
    expect(result).toContain('Root claude');
    expect(result).toContain('Dot-claude instructions');
    await rm(tempDir, { recursive: true });
  });

  it('should prioritize AGENTS.md before compatible CLAUDE.md files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    await writeFile(join(tempDir, 'AGENTS.md'), 'FIRST');
    await writeFile(join(tempDir, 'CLAUDE.md'), 'SECOND');
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: '/nonexistent' });
    expect(result.indexOf('FIRST')).toBeLessThan(result.indexOf('SECOND'));
    await rm(tempDir, { recursive: true });
  });

  it('should prioritize .zero/AGENTS.md before .zero/CLAUDE.md', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    await mkdir(join(tempDir, '.zero'), { recursive: true });
    await writeFile(join(tempDir, '.zero', 'AGENTS.md'), 'FIRST');
    await writeFile(join(tempDir, '.zero', 'CLAUDE.md'), 'SECOND');
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: '/nonexistent' });
    expect(result.indexOf('FIRST')).toBeLessThan(result.indexOf('SECOND'));
    await rm(tempDir, { recursive: true });
  });

  it('should read user-level instruction files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'instruction-home-'));
    await mkdir(join(homeDir, '.zero'), { recursive: true });
    await writeFile(join(homeDir, '.zero', 'AGENTS.md'), 'User-level agents');
    const result = await loadInstructionFiles({ projectRoot: tempDir, userHome: homeDir });
    expect(result).toContain('User-level agents');
    await rm(tempDir, { recursive: true });
    await rm(homeDir, { recursive: true });
  });

  it('should support custom instructionFiles paths', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'instruction-test-'));
    const customFile = join(tempDir, 'custom-instructions.md');
    await writeFile(customFile, 'Custom content');
    const result = await loadInstructionFiles({ instructionFiles: [customFile] });
    expect(result).toContain('Custom content');
    await rm(tempDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// loadMemoryFiles
// ---------------------------------------------------------------------------

describe('loadMemoryFiles', () => {
  it('should return empty string for non-existent directory', async () => {
    const result = await loadMemoryFiles('/nonexistent/path');
    expect(result).toBe('');
  });

  it('should load and concatenate .md files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'memory-test-'));
    await writeFile(join(tempDir, 'patterns.md'), 'Pattern notes');
    await writeFile(join(tempDir, 'debugging.md'), 'Debug notes');
    await writeFile(join(tempDir, 'not-markdown.txt'), 'Should be ignored');

    const result = await loadMemoryFiles(tempDir);
    expect(result).toContain('Debug notes');
    expect(result).toContain('Pattern notes');
    expect(result).not.toContain('Should be ignored');

    // Alphabetical order: debugging.md before patterns.md
    const debugIdx = result.indexOf('Debug notes');
    const patternIdx = result.indexOf('Pattern notes');
    expect(debugIdx).toBeLessThan(patternIdx);

    await rm(tempDir, { recursive: true });
  });
});
