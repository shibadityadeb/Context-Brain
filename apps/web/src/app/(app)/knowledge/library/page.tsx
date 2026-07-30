'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';
import { Button, Card, CardContent, Input } from '@company-brain/ui';
import {
  api,
  type DocumentsTree,
  type OwnerSection,
  type TreeDocument,
  type TreeFolder,
} from '@/lib/api';
import { StatusBadge, formatBytes, formatDate } from '@/components/knowledge/status-badge';

/** Case-insensitive title/filename match used by the client-side filter. */
function docMatches(doc: TreeDocument, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return doc.title.toLowerCase().includes(needle) || doc.fileName.toLowerCase().includes(needle);
}

/** Prune a folder subtree to documents matching the query; drop empty branches. */
function filterFolder(folder: TreeFolder, q: string): TreeFolder | null {
  const documents = folder.documents.filter((d) => docMatches(d, q));
  const folders = folder.folders
    .map((f) => filterFolder(f, q))
    .filter((f): f is TreeFolder => f !== null);
  const documentCount = documents.length + folders.reduce((n, f) => n + f.documentCount, 0);
  if (documentCount === 0) return null;
  return { ...folder, documents, folders, documentCount };
}

function filterOwner(section: OwnerSection, q: string): OwnerSection | null {
  if (!q) return section;
  const rootDocuments = section.rootDocuments.filter((d) => docMatches(d, q));
  const folders = section.folders
    .map((f) => filterFolder(f, q))
    .filter((f): f is TreeFolder => f !== null);
  const documentCount = rootDocuments.length + folders.reduce((n, f) => n + f.documentCount, 0);
  if (documentCount === 0) return null;
  return { ...section, rootDocuments, folders, documentCount };
}

function ownerLabel(owner: OwnerSection['owner']): string {
  if (!owner.id) return 'Unassigned';
  return owner.name ?? owner.email ?? 'Unknown member';
}

export default function LibraryPage() {
  const [tree, setTree] = useState<DocumentsTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTree(await api.documentsTree());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace documents');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (!window.confirm('Delete this document and its embeddings?')) return;
    setBusyId(id);
    try {
      await api.deleteDocument(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reindex(id: string) {
    setBusyId(id);
    try {
      await api.reindexDocument(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const sections = useMemo(() => {
    if (!tree) return [];
    return tree.owners
      .map((s) => filterOwner(s, search))
      .filter((s): s is OwnerSection => s !== null);
  }, [tree, search]);

  const docRow = (doc: TreeDocument, depth: number) => (
    <div
      key={doc.id}
      className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-accent/40"
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Link
        href={`/knowledge/documents/${doc.id}`}
        className="flex-1 truncate text-sm font-medium hover:underline"
        title={doc.fileName}
      >
        {doc.title}
      </Link>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {formatBytes(doc.fileSizeBytes)}
      </span>
      <span className="hidden text-xs text-muted-foreground md:inline">
        {formatDate(doc.updatedAt)}
      </span>
      <StatusBadge status={doc.status} />
      <div className="flex gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          title="Reindex"
          disabled={busyId === doc.id}
          onClick={() => void reindex(doc.id)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Delete"
          disabled={busyId === doc.id}
          onClick={() => void remove(doc.id)}
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Workspace documents</h1>
          <p className="text-sm text-muted-foreground">
            {tree
              ? `${tree.totalDocuments} document${tree.totalDocuments === 1 ? '' : 's'} across ${tree.owners.length} member${tree.owners.length === 1 ? '' : 's'}`
              : 'Loading…'}
          </p>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by title or file name…"
          className="w-64"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {tree && sections.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {search
              ? 'No documents match this filter.'
              : 'No documents yet. Once members connect their Google accounts, their synced documents appear here.'}
          </CardContent>
        </Card>
      )}

      {sections.map((section) => (
        <Card key={section.owner.id ?? '__unowned__'}>
          <CardContent className="p-0">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                {ownerLabel(section.owner).charAt(0).toUpperCase() || <User className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{ownerLabel(section.owner)}</p>
                {section.owner.email && (
                  <p className="truncate text-xs text-muted-foreground">{section.owner.email}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {section.documentCount} document{section.documentCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="p-2">
              {section.folders.map((folder) => (
                <FolderTree key={folder.id} folder={folder} depth={0} renderDoc={docRow} />
              ))}
              {section.rootDocuments.map((doc) => docRow(doc, section.folders.length ? 1 : 0))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FolderTree({
  folder,
  depth,
  renderDoc,
}: {
  folder: TreeFolder;
  depth: number;
  renderDoc: (doc: TreeDocument, depth: number) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left hover:bg-accent/40"
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">{folder.name}</span>
        <span className="text-xs text-muted-foreground">{folder.documentCount}</span>
      </button>
      {open && (
        <div>
          {folder.folders.map((child) => (
            <FolderTree key={child.id} folder={child} depth={depth + 1} renderDoc={renderDoc} />
          ))}
          {folder.documents.map((doc) => renderDoc(doc, depth + 1))}
        </div>
      )}
    </div>
  );
}
