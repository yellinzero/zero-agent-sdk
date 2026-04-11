/**
 * System prompt section caching — memoizes stable sections to avoid
 * redundant computation on each turn, while allowing volatile sections
 * (e.g. date, git status) to be recomputed every time.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ComputeFn = () => string | null | Promise<string | null>;

export interface CachedSystemPromptSection {
  /** Unique identifier for the section */
  name: string;
  /** Function that computes the section content */
  compute: ComputeFn;
  /** If true, the section is recomputed every turn (not cached) */
  cacheBreak: boolean;
}

// ---------------------------------------------------------------------------
// Section factories
// ---------------------------------------------------------------------------

/**
 * Create a cacheable system prompt section.
 * Content is computed once and reused until explicitly invalidated.
 */
export function systemPromptSection(name: string, compute: ComputeFn): CachedSystemPromptSection {
  return { name, compute, cacheBreak: false };
}

/**
 * Create a volatile system prompt section.
 * Content is recomputed on every resolution (e.g. current date, git status).
 */
export function volatileSection(name: string, compute: ComputeFn): CachedSystemPromptSection {
  return { name, compute, cacheBreak: true };
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

const sectionCache = new Map<string, string | null>();

/**
 * Resolve all sections, using cached values for stable sections
 * and recomputing volatile sections.
 */
export async function resolveSections(sections: CachedSystemPromptSection[]): Promise<string> {
  const results = await Promise.all(
    sections.map(async (s) => {
      // Use cached value for stable sections
      if (!s.cacheBreak && sectionCache.has(s.name)) {
        return sectionCache.get(s.name) ?? null;
      }
      const value = await s.compute();
      sectionCache.set(s.name, value);
      return value;
    })
  );
  return results.filter(Boolean).join('\n\n');
}

/**
 * Clear the section cache (e.g. when tools change, config updates, etc.).
 */
export function clearSectionCache(): void {
  sectionCache.clear();
}

/**
 * Invalidate a specific cached section by name.
 */
export function invalidateSection(name: string): void {
  sectionCache.delete(name);
}
