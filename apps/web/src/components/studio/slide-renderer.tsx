'use client';

import { isLayoutId, type ImageRef, type SlideContent, type ThemeId } from '@company-brain/studio';
import type { StudioSlideView } from '@/lib/api';
import { ThemeScope } from './theme-scope';
import { LAYOUT_COMPONENTS, type LayoutProps } from './layouts';

/**
 * Renders one slide: applies the theme scope, picks the layout component, and
 * wires inline editing. `resolveImage` turns an ImageRef into a URL using the
 * deck's uploaded assets (or a direct url on the ref).
 */
export function SlideRenderer({
  slide,
  themeId,
  editable = false,
  onChange,
  assetUrls,
  onReplaceImage,
}: {
  slide: Pick<StudioSlideView, 'layout' | 'content'>;
  themeId: ThemeId;
  editable?: boolean;
  onChange?: (content: SlideContent) => void;
  /** assetId → resolved URL for this deck. */
  assetUrls?: Record<string, string>;
  /** Called when an image slot is clicked in edit mode. */
  onReplaceImage?: (slot: number) => void;
}) {
  const layoutId = isLayoutId(slide.layout) ? slide.layout : 'bullet-list';
  const Layout = LAYOUT_COMPONENTS[layoutId];

  const resolveImage = (ref?: ImageRef): string | undefined => {
    if (!ref) return undefined;
    if (ref.assetId && assetUrls?.[ref.assetId]) return assetUrls[ref.assetId];
    return ref.url;
  };

  const props: LayoutProps = {
    content: slide.content,
    editable,
    onPatch: (patch) => onChange?.({ ...slide.content, ...patch }),
    resolveImage,
    onReplaceImage,
  };

  return (
    <ThemeScope themeId={themeId} className="h-full w-full overflow-hidden">
      {Layout(props)}
    </ThemeScope>
  );
}
