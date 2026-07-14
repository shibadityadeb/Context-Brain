import { cn } from '@company-brain/ui';

const STYLES: Record<string, string> = {
  READY: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PROCESSING: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 animate-pulse',
  UPLOADED: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  FAILED: 'bg-red-500/15 text-red-600 dark:text-red-400',
  ARCHIVED: 'bg-muted text-muted-foreground',
  COMPLETED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  RUNNING: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 animate-pulse',
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STYLES[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {status}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
