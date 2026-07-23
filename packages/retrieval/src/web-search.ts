/**
 * Web search — a retrieval source that lets Ask Brain reach beyond the company's
 * own knowledge, like a browsing assistant. Provider-pluggable and fully
 * config-driven (never hardcoded): DuckDuckGo works with no API key out of the
 * box; Tavily / Brave give richer results when a key is configured. If disabled
 * or a call fails, the source simply returns nothing — the assistant still
 * answers from its own knowledge and the company knowledge base.
 */

import type { RetrievalSource, RetrievedItem } from './types.js';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<WebResult[]>;
}

export type WebSearchProviderName = 'duckduckgo' | 'tavily' | 'brave' | 'none';

export interface WebSearchConfig {
  provider: WebSearchProviderName;
  apiKey?: string | undefined;
  maxResults?: number;
  timeoutMs?: number;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`web search HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Keyless DuckDuckGo Instant Answer API — abstract + related topics. */
class DuckDuckGoProvider implements WebSearchProvider {
  readonly name = 'duckduckgo';
  constructor(private readonly timeoutMs: number) {}
  async search(query: string, limit: number): Promise<WebResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const data = (await fetchJson(url, {}, this.timeoutMs)) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const results: WebResult[] = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }
    for (const topic of data.RelatedTopics ?? []) {
      if (results.length >= limit) break;
      if (topic.Text && topic.FirstURL) {
        results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: topic.Text });
      }
    }
    return results.slice(0, limit);
  }
}

/** Tavily — search API optimized for LLMs (requires an API key). */
class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily';
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}
  async search(query: string, limit: number): Promise<WebResult[]> {
    const data = (await fetchJson(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey, query, max_results: limit }),
      },
      this.timeoutMs,
    )) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? query, url: r.url!, snippet: r.content ?? '' }));
  }
}

/** Brave Search API (requires an API key). */
class BraveProvider implements WebSearchProvider {
  readonly name = 'brave';
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}
  async search(query: string, limit: number): Promise<WebResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
    const data = (await fetchJson(
      url,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey } },
      this.timeoutMs,
    )) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    return (data.web?.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? query, url: r.url!, snippet: r.description ?? '' }));
  }
}

class NullProvider implements WebSearchProvider {
  readonly name = 'none';
  async search(): Promise<WebResult[]> {
    return [];
  }
}

/** Build the configured provider. Missing key → disabled (never throws). */
export function createWebSearchProvider(config: WebSearchConfig): WebSearchProvider {
  const timeoutMs = config.timeoutMs ?? 5000;
  switch (config.provider) {
    case 'tavily':
      return config.apiKey ? new TavilyProvider(config.apiKey, timeoutMs) : new NullProvider();
    case 'brave':
      return config.apiKey ? new BraveProvider(config.apiKey, timeoutMs) : new NullProvider();
    case 'duckduckgo':
      return new DuckDuckGoProvider(timeoutMs);
    default:
      return new NullProvider();
  }
}

/** A retrieval source backed by a web search provider (both scopes). */
export function webSearchSource(provider: WebSearchProvider, maxResults = 4): RetrievalSource {
  return {
    name: 'web-search',
    scopes: ['team', 'personal'],
    async search(ctx): Promise<RetrievedItem[]> {
      if (provider.name === 'none') return [];
      const limit = Math.min(maxResults, ctx.limit);
      // Keyless DuckDuckGo matches topics, not full questions — feed it the
      // extracted keywords; richer providers handle the raw query fine too.
      const query = ctx.terms.length ? ctx.terms.join(' ') : ctx.query.trim();
      const results = await provider.search(query, limit);
      return results.map((r, i) => ({
        id: r.url,
        kind: 'web' as const,
        type: 'WEB',
        title: r.title,
        summary: r.snippet || null,
        url: r.url,
        score: Math.max(0, 0.55 - i * 0.03),
      }));
    },
  };
}
