import { PromptBuilder } from './codex/PromptBuilder.js';
import { normalizeMeetingAnalysis } from './normalize.js';
import type { LLMService } from './service.js';
import type { MeetingAnalysis } from './types.js';
import { isNonEmptyString } from './utils/validation.js';

/**
 * High-level meeting analysis built entirely on top of {@link LLMService}.
 *
 * This is a thin *consumer* of the LLM layer — proof that the generic service
 * is sufficient for a real task without any backend-specific code. Large
 * transcripts are condensed via the service before the single structured
 * extraction, so callers never deal with chunking.
 */
export class MeetingAnalyzer {
  private readonly prompts = new PromptBuilder();

  constructor(private readonly service: LLMService) {}

  /**
   * Analyze a transcript into a structured {@link MeetingAnalysis}.
   * @throws {Error} when the transcript is empty.
   */
  async analyze(transcript: string): Promise<MeetingAnalysis> {
    if (!isNonEmptyString(transcript)) {
      throw new Error('analyzeMeeting: transcript is empty');
    }
    // condense() returns the transcript unchanged when it already fits.
    const content = await this.service.condense(transcript);
    return this.service.json<MeetingAnalysis>(this.prompts.meetingAnalysis(content), {
      validate: normalizeMeetingAnalysis,
    });
  }
}
