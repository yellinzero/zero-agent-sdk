/**
 * Tool registry — register and manage collections of tools.
 */

import type { SDKTool } from './types.js';
import { toolMatchesName } from './types.js';

export class ToolRegistry {
  private tools: SDKTool[] = [];
  private aliasMap = new Map<string, SDKTool>();

  register(...tools: SDKTool[]): void {
    for (const tool of tools) {
      // Prevent duplicate registration
      if (this.tools.some((t) => t.name === tool.name)) {
        continue;
      }
      // Check for alias conflicts
      for (const alias of tool.aliases ?? []) {
        const existing = this.aliasMap.get(alias);
        if (existing) {
          throw new Error(
            `Alias "${alias}" from tool "${tool.name}" conflicts with tool "${existing.name}"`
          );
        }
      }
      this.tools.push(tool);
      for (const alias of tool.aliases ?? []) {
        this.aliasMap.set(alias, tool);
      }
    }
  }

  unregister(name: string): boolean {
    const index = this.tools.findIndex((t) => t.name === name);
    if (index >= 0) {
      const tool = this.tools[index]!;
      // Remove aliases
      for (const alias of tool.aliases ?? []) {
        this.aliasMap.delete(alias);
      }
      this.tools.splice(index, 1);
      return true;
    }
    return false;
  }

  get(name: string): SDKTool | undefined {
    return this.aliasMap.get(name) ?? this.tools.find((t) => toolMatchesName(t, name));
  }

  getAll(): SDKTool[] {
    return [...this.tools];
  }

  getEnabled(): SDKTool[] {
    return this.tools.filter((t) => t.isEnabled());
  }

  has(name: string): boolean {
    return this.tools.some((t) => toolMatchesName(t, name));
  }

  count(): number {
    return this.tools.length;
  }

  clear(): void {
    this.tools = [];
    this.aliasMap.clear();
  }
}
