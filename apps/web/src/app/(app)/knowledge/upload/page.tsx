'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, UploadCloud } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from '@company-brain/ui';
import { api, ApiRequestError } from '@/lib/api';
import { formatBytes } from '@/components/knowledge/status-badge';

const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm';

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { document } = await api.uploadDocument({
        file,
        title: title || undefined,
        description: description || undefined,
        tags: tags || undefined,
      });
      router.push(`/knowledge/documents/${document.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Upload failed — please try again');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload document</h1>
        <p className="text-sm text-muted-foreground">
          PDF, DOCX, TXT, Markdown, CSV, JSON or HTML — parsed, chunked, embedded and indexed
          automatically.
        </p>
      </div>

      <form onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>File</CardTitle>
            <CardDescription>Drag &amp; drop or browse. Max 50 MB.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-sm transition-colors',
                dragging ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent/50',
              )}
            >
              {file ? (
                <>
                  <FileUp className="h-8 w-8 text-primary" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-muted-foreground">{formatBytes(file.size)}</span>
                </>
              ) : (
                <>
                  <UploadCloud className="h-8 w-8 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Drop a file here, or click to browse
                  </span>
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">Title (optional)</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Defaults to the file name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input
                  id="tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="handbook, onboarding"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this document about?"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <Button type="submit" disabled={!file || busy} className="w-full">
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
                </>
              ) : (
                'Upload & process'
              )}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
