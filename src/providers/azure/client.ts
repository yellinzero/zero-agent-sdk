/**
 * Azure OpenAI provider implementation.
 * Extends OpenAICompatibleProvider with Azure-specific features:
 * - Deployment-based URL construction
 * - api-key header authentication
 * - api-version query parameter
 */

import type { OpenAICompatibleConfig } from '../openai-compatible/base.js';
import { OpenAICompatibleProvider } from '../openai-compatible/base.js';
import type { ModelInfo } from '../types.js';
import { getAzureModelInfo } from './models.js';

export interface AzureOpenAIProviderConfig extends OpenAICompatibleConfig {
  /** Azure resource name (e.g. 'my-openai-resource'). */
  resourceName?: string;

  /** Deployment ID (e.g. 'gpt-4o-deployment'). */
  deploymentId?: string;

  /** API version (e.g. '2024-10-21'). */
  apiVersion?: string;
}

export class AzureOpenAIProvider extends OpenAICompatibleProvider {
  readonly providerId = 'azure';
  private resourceName?: string;
  private deploymentId?: string;
  private apiVersion: string;

  constructor(config: AzureOpenAIProviderConfig = {}) {
    super(config);
    this.resourceName = config.resourceName ?? process.env.AZURE_OPENAI_RESOURCE_NAME;
    this.deploymentId = config.deploymentId ?? process.env.AZURE_OPENAI_DEPLOYMENT_ID;
    this.apiVersion = config.apiVersion ?? '2024-10-21';
  }

  protected getDefaultApiKeyEnvVar(): string {
    return 'AZURE_OPENAI_API_KEY';
  }

  protected getDefaultBaseUrl(): string {
    if (this.resourceName) {
      return `https://${this.resourceName}.openai.azure.com/openai/deployments/${this.deploymentId ?? ''}`;
    }
    return 'https://openai.azure.com/openai';
  }

  protected getProviderName(): string {
    return 'Azure OpenAI';
  }

  getModelInfo(modelId: string): ModelInfo {
    return this.withStructuredOutputDefaults(getAzureModelInfo(modelId));
  }

  protected override async getClient(): Promise<any> {
    if (!(this as any)._client) {
      try {
        const openaiModule = await import('openai');
        const AzureOpenAI = openaiModule.AzureOpenAI;

        const apiKey = this.resolveApiKey();
        const baseUrl = this.config.baseUrl ?? this.getDefaultBaseUrl();

        (this as any)._client = new AzureOpenAI({
          apiKey,
          endpoint: baseUrl,
          apiVersion: this.apiVersion,
          defaultHeaders: this.config.defaultHeaders,
          maxRetries: this.config.maxRetries ?? 2,
        });
      } catch {
        throw new Error('Failed to import openai. Install it with: npm install openai');
      }
    }
    return (this as any)._client;
  }
}

export function createAzureOpenAIProvider(config?: AzureOpenAIProviderConfig): AzureOpenAIProvider {
  return new AzureOpenAIProvider(config);
}

export function azure(config?: AzureOpenAIProviderConfig): AzureOpenAIProvider {
  return createAzureOpenAIProvider(config);
}
