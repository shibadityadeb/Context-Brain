import { AnthropicProvider } from './anthropic.provider.js';
import { CodexProvider } from './codex.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { LocalProvider } from './local.provider.js';
import { MockProvider } from './mock.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import type { LLMConfig, LLMProvider } from './types.js';

export * from './types.js';
export {
  AnthropicProvider,
  CodexProvider,
  GeminiProvider,
  LocalProvider,
  MockProvider,
  OpenAIProvider,
};

/** Build the configured provider. Never hardcode a vendor at call sites. */
export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'codex':
      return new CodexProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'local':
      return new LocalProvider(config);
    case 'mock':
      return new MockProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${String(config.provider)}`);
  }
}
