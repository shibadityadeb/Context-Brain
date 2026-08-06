'use client';

import { useEffect, useRef, type ElementType } from 'react';
import { cn } from '@company-brain/ui';

/**
 * Inline-editable text. In edit mode it's a `contentEditable` element bound to
 * the content model: keystrokes stay local (uncontrolled) for a native caret,
 * and the new value is committed on blur / Enter. Not a rich-text editor — plain
 * text only, which is all a presentation-ready slide field needs in Phase 1.
 */
export function EditableText({
  value,
  onCommit,
  editable,
  placeholder,
  multiline = false,
  className,
  as: As = 'div',
}: {
  value: string;
  onCommit: (next: string) => void;
  editable: boolean;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  /** Semantic tag for the read-only render (edit mode always uses a div). */
  as?: ElementType;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep the DOM in sync when the value changes externally (copilot, undo) but
  // never while the user is typing (would reset the caret).
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) {
      el.textContent = value;
    }
  }, [value]);

  if (!editable) {
    const Tag: ElementType = As ?? 'div';
    return <Tag className={className}>{value || placeholder}</Tag>;
  }

  const commit = () => {
    const next = ref.current?.textContent ?? '';
    if (next !== value) onCommit(next);
  };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
      }}
      className={cn(
        'outline-none focus:ring-2 focus:ring-[var(--studio-primary)]/40 rounded-[4px] focus:bg-[var(--studio-primary)]/5 transition-shadow',
        'empty:before:content-[attr(data-placeholder)] empty:before:opacity-40 cursor-text',
        className,
      )}
    >
      {value}
    </div>
  );
}

/**
 * An editable image slot constrained to its layout position (object-fit cover +
 * focal point) — no free canvas. Click to replace/upload when editable.
 */
export function EditableImage({
  url,
  alt,
  editable,
  onReplace,
  focalX = 0.5,
  focalY = 0.5,
  className,
  rounded = true,
}: {
  url?: string;
  alt?: string;
  editable: boolean;
  onReplace?: () => void;
  focalX?: number;
  focalY?: number;
  className?: string;
  rounded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={editable ? onReplace : undefined}
      disabled={!editable}
      className={cn(
        'group relative block h-full w-full overflow-hidden',
        rounded && 'rounded-[var(--studio-radius)]',
        editable && 'cursor-pointer',
        className,
      )}
      style={{ background: 'var(--studio-surface)' }}
    >
      {url ? (
        <img
          src={url}
          alt={alt ?? ''}
          className="h-full w-full object-cover"
          style={{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center text-sm"
          style={{ color: 'var(--studio-muted)' }}
        >
          {editable ? 'Click to add image' : 'Image'}
        </span>
      )}
      {editable && (
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/40 text-xs font-medium text-white group-hover:flex">
          Replace image
        </span>
      )}
    </button>
  );
}
