import { describe, expect, it, vi } from 'vitest';
import { MeetingAnalyzer } from './meeting.js';
import type { LLMProvider } from './provider.js';
import { LLMService } from './service.js';
import type { LLMServiceConfig, MeetingAnalysis } from './types.js';
import { silentLogger } from './utils/logger.js';

const fullAnalysis: MeetingAnalysis = {
  summary: 'We shipped the thing.',
  decisions: [{ decision: 'Adopt X', rationale: 'faster' }],
  tasks: [{ title: 'Write docs', owner: 'Sam', due: 'Friday' }],
  risks: [{ risk: 'Scope creep', severity: 'high' }],
  blockers: ['Waiting on legal'],
  followUps: ['Schedule review'],
};

function stubProvider(): LLMProvider & {
  generate: ReturnType<typeof vi.fn>;
  generateJson: ReturnType<typeof vi.fn>;
} {
  return {
    name: 'stub',
    model: 'stub',
    generate: vi.fn().mockResolvedValue('S'),
    generateJson: vi.fn().mockResolvedValue(fullAnalysis),
  };
}

const config: LLMServiceConfig = { maxPromptChars: 50, maxConcurrency: 2, maxReduceDepth: 8 };

const analyzerWith = (provider: LLMProvider, over: Partial<LLMServiceConfig> = {}) =>
  new MeetingAnalyzer(new LLMService(provider, { ...config, ...over }, { logger: silentLogger }));

describe('MeetingAnalyzer', () => {
  it('analyzes a small transcript with a single extraction call', async () => {
    const provider = stubProvider();
    const result = await analyzerWith(provider, { maxPromptChars: 10_000 }).analyze('short notes');

    expect(result).toEqual(fullAnalysis);
    expect(provider.generate).not.toHaveBeenCalled(); // no condensing needed
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
  });

  it('condenses a large transcript before the single extraction', async () => {
    const provider = stubProvider();
    await analyzerWith(provider, { maxPromptChars: 40 }).analyze('x'.repeat(400));

    expect(provider.generate.mock.calls.length).toBeGreaterThan(1); // condensing
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    const finalPrompt = provider.generateJson.mock.calls[0]?.[0] as string;
    expect(finalPrompt).not.toContain('x'.repeat(100)); // ran on the digest
  });

  it('rejects an empty transcript', async () => {
    await expect(analyzerWith(stubProvider()).analyze('   ')).rejects.toThrow(/empty/);
  });
});
