/**
 * Provider registry — resolves "provider:model" strings to ModelProvider instances.
 */

import { AgentError } from '../core/errors.js';
import type { ModelProvider } from './types.js';

export class ProviderRegistry {
  private providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  get(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Resolve a "provider:model" string.
   * Returns the provider and model ID.
   */
  resolve(specifier: string): { provider: ModelProvider; modelId: string } {
    const colonIndex = specifier.indexOf(':');
    if (colonIndex === -1) {
      // No provider prefix — try to find a default or single registered provider
      if (this.providers.size === 1) {
        const provider = [...this.providers.values()][0]!;
        return { provider, modelId: specifier };
      }
      throw new AgentError(
        `Ambiguous model specifier "${specifier}". Use "provider:model" format or register a single provider.`,
        'INVALID_CONFIG'
      );
    }

    const providerId = specifier.slice(0, colonIndex);
    const modelId = specifier.slice(colonIndex + 1);
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new AgentError(
        `Unknown provider "${providerId}". Registered providers: ${[...this.providers.keys()].join(', ')}`,
        'INVALID_CONFIG'
      );
    }

    return { provider, modelId };
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}

/** Global default registry */
export const defaultRegistry = new ProviderRegistry();
