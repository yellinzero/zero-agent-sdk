import { describe, expect, it } from 'vitest';
import {
  builtinTools,
  createBashTool,
  createFileEditTool,
  createFileReadTool,
  createFileWriteTool,
  createGlobTool,
  createGrepTool,
  createNotebookEditTool,
} from '../tools/builtin/index.js';

describe('builtinTools', () => {
  it('should return all 7 tools by default', () => {
    const tools = builtinTools();
    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name);
    expect(names).toContain('Bash');
    expect(names).toContain('Read');
    expect(names).toContain('Write');
    expect(names).toContain('Edit');
    expect(names).toContain('Glob');
    expect(names).toContain('Grep');
    expect(names).toContain('NotebookEdit');
  });

  it('should respect options to exclude tools', () => {
    const tools = builtinTools({ bash: false, notebookEdit: false });
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name)).not.toContain('Bash');
    expect(tools.map((t) => t.name)).not.toContain('NotebookEdit');
  });

  it('should return read-only tools via convenience method', () => {
    const tools = builtinTools.readOnly();
    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain('Read');
    expect(names).toContain('Glob');
    expect(names).toContain('Grep');
    expect(names).not.toContain('Bash');
    expect(names).not.toContain('Write');
    expect(names).not.toContain('Edit');
  });

  it('all() should return same as default', () => {
    expect(builtinTools.all()).toHaveLength(builtinTools().length);
  });
});

describe('individual tool creation', () => {
  it('createGlobTool returns tool named Glob', () => {
    const tool = createGlobTool();
    expect(tool.name).toBe('Glob');
    expect(tool.isConcurrencySafe({ pattern: '*.ts' })).toBe(true);
    expect(tool.isReadOnly({ pattern: '*.ts' })).toBe(true);
    expect(tool.isEnabled()).toBe(true);
  });

  it('createGrepTool returns tool named Grep', () => {
    const tool = createGrepTool();
    expect(tool.name).toBe('Grep');
    expect(tool.isConcurrencySafe({ pattern: 'foo' })).toBe(true);
    expect(tool.isReadOnly({ pattern: 'foo' })).toBe(true);
  });

  it('createFileReadTool returns tool named Read', () => {
    const tool = createFileReadTool();
    expect(tool.name).toBe('Read');
    expect(tool.isReadOnly({ file_path: '/tmp/test' })).toBe(true);
  });

  it('createFileWriteTool returns tool named Write', () => {
    const tool = createFileWriteTool();
    expect(tool.name).toBe('Write');
    expect(tool.isReadOnly({ file_path: '/tmp/test', content: '' })).toBe(false);
    expect(tool.isConcurrencySafe({ file_path: '/tmp/test', content: '' })).toBe(false);
  });

  it('createFileEditTool returns tool named Edit', () => {
    const tool = createFileEditTool();
    expect(tool.name).toBe('Edit');
    expect(tool.isReadOnly({ file_path: '/tmp/test', old_string: 'a', new_string: 'b' })).toBe(
      false
    );
  });

  it('createBashTool returns tool named Bash', () => {
    const tool = createBashTool();
    expect(tool.name).toBe('Bash');
    expect(tool.isConcurrencySafe({ command: 'ls' })).toBe(false);
    expect(tool.isDestructive?.({ command: 'rm -rf /tmp/x' })).toBe(true);
    expect(tool.isDestructive?.({ command: 'ls' })).toBe(false);
  });

  it('createNotebookEditTool returns tool named NotebookEdit', () => {
    const tool = createNotebookEditTool();
    expect(tool.name).toBe('NotebookEdit');
    expect(tool.isConcurrencySafe({ notebook_path: '/tmp/test.ipynb', new_source: '' })).toBe(
      false
    );
  });
});
