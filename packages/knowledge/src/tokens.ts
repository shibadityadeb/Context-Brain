/**
 * Fast token estimate (≈ GPT-family BPE): mean of the character-based
 * (chars/4) and word-based (words×1.33) heuristics. Good enough for chunk
 * budgeting; exact counts belong to the embedding provider.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil((text.length / 4 + words * 1.33) / 2));
}
