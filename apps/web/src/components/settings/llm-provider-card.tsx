'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Cpu, ExternalLink, Eye, EyeOff, Loader2, Wifi, X } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@company-brain/ui';
import {
  ApiRequestError,
  llmApi,
  type LlmConnectionResult,
  type LlmProviderCatalogEntry,
  type LlmProviderId,
  type LlmSettingsView,
} from '@/lib/api';

type TestState =
  { kind: 'idle' } | { kind: 'testing' } | { kind: 'done'; result: LlmConnectionResult };

export function LlmProviderCard() {
  const [catalog, setCatalog] = useState<LlmProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [provider, setProvider] = useState<LlmProviderId>('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);

  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  // Snapshot of the saved config, to restore fields when the user returns to it.
  const [stored, setStored] = useState<LlmSettingsView | null>(null);

  const entry = useMemo(() => catalog.find((c) => c.id === provider), [catalog, provider]);

  // Load the provider catalog + the user's saved config.
  useEffect(() => {
    void (async () => {
      try {
        const [providers, settings] = await Promise.all([llmApi.providers(), llmApi.getSettings()]);
        setCatalog(providers);
        if (settings.configured && settings.provider) {
          setStored(settings);
          setProvider(settings.provider);
          setBaseUrl(settings.baseUrl ?? '');
          setModel(settings.model ?? '');
          setHasStoredKey(settings.hasKey);
        } else {
          const first = providers[0];
          if (first) setModel(first.defaultModel);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onProviderChange = useCallback(
    (id: LlmProviderId) => {
      setProvider(id);
      setError(null);
      setSaved(false);
      setTest({ kind: 'idle' });
      setApiKey('');
      const next = catalog.find((c) => c.id === id);
      if (stored?.provider === id) {
        // Returning to the saved provider — restore its stored config.
        setBaseUrl(stored.baseUrl ?? '');
        setModel(stored.model ?? next?.defaultModel ?? '');
        setHasStoredKey(stored.hasKey);
      } else {
        // A different provider needs its own key and defaults.
        setBaseUrl('');
        setModel(next?.defaultModel ?? '');
        setHasStoredKey(false);
      }
    },
    [catalog, stored],
  );

  const needsBaseUrl = !!entry?.requiresBaseUrl;
  const keyReady = apiKey.trim().length > 0 || hasStoredKey;
  const baseUrlReady = !needsBaseUrl || baseUrl.trim().length > 0;
  const canSubmit = keyReady && baseUrlReady && !!model.trim();

  async function save() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await llmApi.saveSettings({
        provider,
        apiKey: apiKey.trim() || undefined,
        baseUrl: entry?.supportsBaseUrl ? baseUrl.trim() || null : undefined,
        model: model.trim() || undefined,
      });
      setStored(res);
      setHasStoredKey(res.hasKey);
      setApiKey('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTest({ kind: 'testing' });
    setError(null);
    try {
      const result = await llmApi.testConnection({
        provider,
        apiKey: apiKey.trim() || undefined,
        baseUrl: entry?.supportsBaseUrl ? baseUrl.trim() || null : undefined,
        model: model.trim() || undefined,
      });
      setTest({ kind: 'done', result });
    } catch (err) {
      setTest({
        kind: 'done',
        result: {
          ok: false,
          status: 'unreachable',
          message: err instanceof ApiRequestError ? err.message : 'Test failed.',
        },
      });
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">LLM Provider</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Cpu className="h-5 w-5 text-ai" /> LLM Provider
        </CardTitle>
        <CardDescription>
          Bring your own AI provider and API key. Saved securely for future use — Brain currently
          runs on its built-in engine and isn&rsquo;t affected yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Provider */}
        <div className="space-y-1.5">
          <Label htmlFor="llm-provider">Provider</Label>
          <select
            id="llm-provider"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as LlmProviderId)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* API key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="llm-key">{entry?.apiKeyLabel ?? 'API Key'}</Label>
            {entry?.docsUrl && (
              <a
                href={entry.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Get a key <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="relative">
            <Input
              id="llm-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
                setTest({ kind: 'idle' });
              }}
              placeholder={hasStoredKey ? '•••••••••••••• (saved)' : 'Paste your API key'}
              autoComplete="off"
              spellCheck={false}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Stored encrypted at rest. {hasStoredKey && 'Leave blank to keep your saved key.'}
          </p>
        </div>

        {/* Base URL (custom endpoints only) */}
        {entry?.supportsBaseUrl && (
          <div className="space-y-1.5">
            <Label htmlFor="llm-baseurl">
              Base URL {needsBaseUrl && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id="llm-baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-endpoint.com/v1"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {/* Model — dropdown for well-known providers, free text otherwise. */}
        <div className="space-y-1.5">
          <Label htmlFor="llm-model">Model</Label>
          {entry?.modelSelection === 'list' ? (
            <select
              id="llm-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {/* Keep a saved-but-unlisted model selectable rather than blank. */}
              {(model && !entry.models.includes(model)
                ? [model, ...entry.models]
                : entry.models
              ).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <>
              <Input
                id="llm-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={entry?.defaultModel || 'e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo'}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Enter the exact model id
                {entry?.modelsDocUrl ? (
                  <>
                    {' '}
                    from{' '}
                    <a
                      href={entry.modelsDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2"
                    >
                      {entry.label}&rsquo;s model list
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                ) : (
                  ' supported by your endpoint'
                )}
                .
              </p>
            </>
          )}
        </div>

        {/* Test result */}
        {test.kind === 'done' && (
          <div
            className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${
              test.result.ok
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            }`}
          >
            {test.result.ok ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : test.result.status === 'invalid_key' ? (
              <X className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{test.result.message}</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={save} disabled={saving || !canSubmit} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={runTest}
            disabled={test.kind === 'testing' || !keyReady || !baseUrlReady || !model.trim()}
            className="gap-2"
          >
            {test.kind === 'testing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wifi className="h-4 w-4" />
            )}
            Test Connection
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
